export interface DirectLine {
  lineUuid: string
  productName: string
  size: string
  color: string
  qty: number
  unitCost: number
  unitPrice: number
}

export interface DirectTradeMeta {
  uuid: string
  revision: string
  previousRevision?: string
  counterpartUuid: string
  status: 'active' | 'cancelled'
}

export type DirectPaymentRoute = 'customerCash' | 'supplierPayment' | 'customerToSupplier'

export interface DirectPaymentRef {
  tradeUuid: string
  route: DirectPaymentRoute
  supplierId?: number
  supplierUuid?: string
  supplierName?: string
}

export interface DirectPaymentInput {
  eventUuid: string
  route: DirectPaymentRoute
  date: number
  amount: number
  box?: string
  sarrafId?: number
  sarrafAmount?: number
  note?: string
}

export interface DirectTotals { cost: number; sale: number; profit: number; pairs: number }

export interface DirectBalances {
  customerRemaining: number
  supplierRemaining: number
  customerCash: number
  supplierPaid: number
  customerToSupplier: number
  cashDelta: number
  overallocated: boolean
}
