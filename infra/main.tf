terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.0" }
  }
}

provider "aws" {
  region = var.aws_region
}

# ECS Cluster for keeper
resource "aws_ecs_cluster" "keeper" {
  name = "walwatch-keeper"
}

# Secrets Manager entries for sensitive keeper configuration
resource "aws_secretsmanager_secret" "keeper_private_key" {
  name = "walwatch-keeper-private-key"
}

resource "aws_secretsmanager_secret" "database_url" {
  name = "walwatch-keeper-database-url"
}

resource "aws_secretsmanager_secret" "resend_api_key" {
  name = "walwatch-keeper-resend-api-key"
}

resource "aws_secretsmanager_secret" "webhook_secret" {
  name = "walwatch-keeper-webhook-secret"
}

# ECS Task Definition for keeper
resource "aws_ecs_task_definition" "keeper" {
  family                   = "walwatch-keeper"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([
    {
      name  = "keeper"
      image = var.keeper_image
      environment = [
        { name = "SUI_RPC_URL",       value = var.sui_rpc_url },
        { name = "PACKAGE_ID",        value = var.package_id },
        { name = "SYSTEM_OBJECT_ID",  value = var.system_object_id },
        { name = "SCAN_SCHEDULE",     value = "*/2 * * * *" },
      ]
      secrets = [
        { name = "KEEPER_PRIVATE_KEY", valueFrom = aws_secretsmanager_secret.keeper_private_key.arn },
        { name = "DATABASE_URL",       valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = "RESEND_API_KEY",     valueFrom = aws_secretsmanager_secret.resend_api_key.arn },
        { name = "NOTIFICATION_WEBHOOK_SECRET", valueFrom = aws_secretsmanager_secret.webhook_secret.arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/walwatch-keeper"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "keeper"
        }
      }
    }
  ])
}

# =============================================================================
# API Service
# =============================================================================

resource "aws_secretsmanager_secret" "api_database_url" {
  name = "walwatch-api-database-url"
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name = "walwatch-api-jwt-secret"
}

resource "aws_ecs_task_definition" "api" {
  family                   = "walwatch-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([
    {
      name  = "api"
      image = "${var.image_prefix}/api:latest"
      portMappings = [
        { containerPort = 3001, protocol = "tcp" }
      ]
      environment = [
        { name = "ALLOWED_ORIGINS", value = "https://walwatch.app" },
        { name = "SUI_RPC_URL",     value = var.sui_rpc_url },
        { name = "PACKAGE_ID",      value = var.package_id },
        { name = "SYSTEM_OBJECT_ID", value = var.system_object_id },
        { name = "WAL_COIN_TYPE",   value = var.wal_coin_type },
        { name = "NODE_ENV",        value = var.environment_name },
      ]
      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.api_database_url.arn },
        { name = "JWT_SECRET",   valueFrom = aws_secretsmanager_secret.jwt_secret.arn },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/walwatch-api"
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "api"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:3001/api/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])
}

resource "aws_ecs_service" "api" {
  name            = var.api_service_name
  cluster         = aws_ecs_cluster.keeper.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.subnet_ids
    security_groups = [aws_security_group.api.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3001
  }

  depends_on = [
    aws_lb_listener.api_https,
  ]
}

# IAM policy for API secrets
resource "aws_iam_policy" "api_secrets_read" {
  name = "walwatch-api-secrets-read"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue",
      ]
      Resource = [
        aws_secretsmanager_secret.api_database_url.arn,
        aws_secretsmanager_secret.jwt_secret.arn,
      ]
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_api_secrets" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = aws_iam_policy.api_secrets_read.arn
}

# =============================================================================
# Application Load Balancer (for API Service)
# =============================================================================

resource "aws_lb" "api" {
  name               = "walwatch-api-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.api_alb.id]
  subnets            = var.subnet_ids

  enable_deletion_protection = true
}

resource "aws_lb_target_group" "api" {
  name        = "walwatch-api-tg"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/api/health"
    port                = 3001
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
    matcher             = "200"
  }
}

resource "aws_lb_listener" "api_https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-2016-08"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# Security group for API service (ECS tasks behind ALB)
resource "aws_security_group" "api" {
  name_prefix = "walwatch-api-"
  description = "Security group for WalWatch API ECS tasks — ingress from ALB only"

  ingress {
    from_port       = 3001
    to_port         = 3001
    protocol        = "tcp"
    security_groups = [aws_security_group.api_alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Security group for the ALB itself — allows HTTPS from the internet
# Inbound 443 is opened to 0.0.0.0/0 because the ALB is internet-facing and
# serves the public API (wallet dApp and CLI clients connect over HTTPS).
# The ALB terminates TLS and forwards to the ECS tasks over HTTP (within VPC),
# so traffic is encrypted in transit to the load balancer boundary.
resource "aws_security_group" "api_alb" {
  name_prefix = "walwatch-api-alb-"
  description = "Internet-facing ALB security group — HTTPS inbound from anywhere"

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# IAM policy to allow ECS task to read secrets
resource "aws_iam_policy" "secrets_read" {
  name = "walwatch-keeper-secrets-read"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue",
      ]
      Resource = [
        aws_secretsmanager_secret.keeper_private_key.arn,
        aws_secretsmanager_secret.database_url.arn,
        aws_secretsmanager_secret.resend_api_key.arn,
        aws_secretsmanager_secret.webhook_secret.arn,
      ]
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_secrets" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = aws_iam_policy.secrets_read.arn
}

# ECS Service for keeper (runs 2 instances for redundancy)
resource "aws_ecs_service" "keeper" {
  name            = "walwatch-keeper"
  cluster         = aws_ecs_cluster.keeper.id
  task_definition = aws_ecs_task_definition.keeper.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.subnet_ids
    security_groups = [aws_security_group.keeper.id]
  }
}

# RDS PostgreSQL for API + keeper leader election
# Master password is managed via AWS Secrets Manager (auto-rotated)
resource "aws_db_instance" "postgres" {
  identifier     = "walwatch"
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t3.medium"
  db_name        = "walwatch"
  username       = var.db_username
  manage_master_user_password = true
  publicly_accessible   = false
  vpc_security_group_ids = [aws_security_group.keeper.id]
  skip_final_snapshot     = false
  final_snapshot_identifier = "walwatch-final-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"
  storage_encrypted       = true
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"
  copy_tags_to_snapshot   = true
  deletion_protection     = true
}

# Security group for keeper
# Keeper initiates all outbound connections (Sui RPC, Resend, webhooks, PostgreSQL)
# No public inbound access — Prometheus scraping uses VPC-private connectivity
resource "aws_security_group" "keeper" {
  name_prefix = "walwatch-keeper-"
  description = "Outbound-only security group for Walwatch Keeper — no public ingress"

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# IAM role for ECS execution
resource "aws_iam_role" "ecs_execution" {
  name = "walwatch-ecs-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })
}

# =============================================================================
# SNS Topic for Alarm Notifications
# =============================================================================
resource "aws_sns_topic" "alarms" {
  name = "${var.application_name}-alarms"
}

resource "aws_sns_topic_subscription" "alarms_email" {
  count                  = var.alarm_notification_email != "" ? 1 : 0
  topic_arn              = aws_sns_topic.alarms.arn
  protocol               = "email"
  endpoint               = var.alarm_notification_email
}

# =============================================================================
# CloudWatch Metric Alarms
# =============================================================================
resource "aws_cloudwatch_metric_alarm" "keeper_cpu_high" {
  alarm_name          = "${var.application_name}-keeper-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 150
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "ECS keeper CPU utilization above 80% for 5 minutes"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.ecs_service_name
  }
}

resource "aws_cloudwatch_metric_alarm" "keeper_memory_high" {
  alarm_name          = "${var.application_name}-keeper-memory-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 150
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "ECS keeper memory utilization above 80% for 5 minutes"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.ecs_service_name
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  alarm_name          = "${var.application_name}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 150
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU utilization above 80% for 5 minutes"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_connections_high" {
  alarm_name          = "${var.application_name}-rds-connections-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "DatabaseConnections"
  namespace           = "AWS/RDS"
  period              = 150
  statistic           = "Average"
  threshold           = 100
  alarm_description   = "RDS database connections above 100 for 5 minutes"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.postgres.identifier
  }
}

resource "aws_cloudwatch_metric_alarm" "keeper_gas_low" {
  alarm_name          = "${var.application_name}-keeper-gas-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "KeeperGasBalance"
  namespace           = "WalWatch/Keeper"
  period              = 300
  statistic           = "Minimum"
  threshold           = 0.1
  alarm_description   = "Keeper wallet SUI gas balance is low (below 0.1 SUI)"
  alarm_actions       = [aws_sns_topic.alarms.arn]

  # Custom metric published by keeper via put-metric-data
}

# =============================================================================
# ECS Auto-Scaling
# =============================================================================
resource "aws_appautoscaling_target" "keeper" {
  service_namespace  = "ecs"
  resource_id        = "service/${var.ecs_cluster_name}/${var.ecs_service_name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = 1
  max_capacity       = 4
}

resource "aws_appautoscaling_policy" "keeper_cpu_scale_up" {
  name               = "${var.application_name}-keeper-cpu-scale-up"
  service_namespace  = aws_appautoscaling_target.keeper.service_namespace
  resource_id        = aws_appautoscaling_target.keeper.resource_id
  scalable_dimension = aws_appautoscaling_target.keeper.scalable_dimension

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 180
    metric_aggregation_type = "Average"

    step_adjustment {
      metric_interval_lower_bound = 0
      scaling_adjustment          = 1
    }
  }
}

resource "aws_appautoscaling_policy" "keeper_cpu_scale_down" {
  name               = "${var.application_name}-keeper-cpu-scale-down"
  service_namespace  = aws_appautoscaling_target.keeper.service_namespace
  resource_id        = aws_appautoscaling_target.keeper.resource_id
  scalable_dimension = aws_appautoscaling_target.keeper.scalable_dimension

  step_scaling_policy_configuration {
    adjustment_type         = "ChangeInCapacity"
    cooldown                = 300
    metric_aggregation_type = "Average"

    step_adjustment {
      metric_interval_upper_bound = 0
      scaling_adjustment          = -1
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "keeper_cpu_scaling_up" {
  alarm_name          = "${var.application_name}-keeper-cpu-scaling-up"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 120
  statistic           = "Average"
  threshold           = 70
  alarm_description   = "Scale up ECS when CPU exceeds 70%"
  alarm_actions       = [aws_appautoscaling_policy.keeper_cpu_scale_up.arn]

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.ecs_service_name
  }
}

resource "aws_cloudwatch_metric_alarm" "keeper_cpu_scaling_down" {
  alarm_name          = "${var.application_name}-keeper-cpu-scaling-down"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 5
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 120
  statistic           = "Average"
  threshold           = 30
  alarm_description   = "Scale down ECS when CPU is below 30% for 10 minutes"
  alarm_actions       = [aws_appautoscaling_policy.keeper_cpu_scale_down.arn]

  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.ecs_service_name
  }
}
