export interface TeamMember {
  name?: string
  github: string
}

export interface TeamData {
  [key: string]: {
    description?: string
    slack: string
    members: TeamMember[]
  }
}
