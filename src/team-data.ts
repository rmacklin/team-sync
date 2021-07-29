export interface TeamMember {
  name?: string
  github: string
}

export interface TeamData {
  [key: string]: {
    team_sync_ignored?: boolean;
    description?: string
    slack?: string
    members?: TeamMember[]
  }
}
