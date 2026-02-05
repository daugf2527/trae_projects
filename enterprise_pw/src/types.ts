export type AccountConfig = {
  label: string
  proxy?: string
  metamaskPassword: string
  metamaskSeedPhrase?: string
  metamaskPrivateKey?: string
  emailAccount?: string
  emailPassword?: string
  emailImapServer?: string
  inviteCode?: string
}

export type ProxyConfig = {
  server: string
  username?: string
  password?: string
  bypass?: string
}
