export type Platform = {
  id: number
  family: string
  name: string
}

export type Subscription = {
  id: number
  name: string
  tier: string | null
  kind: 'subscription' | 'cloud'
}

export type Genre = {
  id: number
  name: string
}

export const platformFamilyOrder = ['pc', 'mobile', 'xbox', 'playstation', 'nintendo']

export const platformFamilyLabels: Record<string, string> = {
  pc: 'PC',
  mobile: 'Móvil',
  xbox: 'Xbox',
  playstation: 'PlayStation',
  nintendo: 'Nintendo',
}
