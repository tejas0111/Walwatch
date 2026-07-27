export type Vault = {
  id: string
  name: string
  blobId: string
  balance: number
  active: boolean
  renewals: number
  threshold: number
  extension: number
  estimatedCost: number
  nextEpoch: number
}

export const vaults: Vault[] = [
  {
    id: "0x91b4",
    name: "Production assets",
    blobId: "KJo1...w92",
    balance: 42.8,
    active: true,
    renewals: 12,
    threshold: 15,
    extension: 60,
    estimatedCost: 3.2,
    nextEpoch: 824,
  },
  {
    id: "0x2ca8",
    name: "Model checkpoints",
    blobId: "8QrP...k11",
    balance: 14.2,
    active: true,
    renewals: 4,
    threshold: 10,
    extension: 30,
    estimatedCost: 2.8,
    nextEpoch: 811,
  },
  {
    id: "0x7de3",
    name: "Archive snapshots",
    blobId: "Az0m...p47",
    balance: 6.1,
    active: false,
    renewals: 8,
    threshold: 20,
    extension: 90,
    estimatedCost: 4.1,
    nextEpoch: 830,
  },
]
