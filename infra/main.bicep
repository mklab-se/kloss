// kloss on Azure: one resource group with a Container Apps environment, a registry and the
// kloss app (scale 0 to 1). `azd up` creates or updates it; `azd down` removes it.
targetScope = 'subscription'

@minLength(1)
@description('The azd environment name; it names the resources.')
param environmentName string

@description('Azure region.')
param location string = 'swedencentral'

@description('Whether the kloss Container App already exists (azd sets this).')
param klossExists bool = false

@secure()
@description('The class password (any e-mail address plus this). Empty turns login off.')
param klossPassword string = ''

@secure()
@description('The admin password for /admin, where MCP is turned on and off.')
param klossAdminPassword string = ''

@secure()
@description('Signs login tokens, so they survive the app sleeping and waking.')
param klossTokenSecret string = ''

@description('Remove sessions idle this long (like 2h or 30m).')
param sessionIdle string = '2h'

@description('Start with the MCP endpoint on, also after waking from sleep (azd env set KLOSS_MCP true). /admin still switches it at runtime.')
param mcpOnStart bool = false

var tags = { 'azd-env-name': environmentName, app: 'kloss' }
var appName = 'ca-kloss-${environmentName}'
// azd swaps this placeholder for the kloss image on deploy; it listens on 8080 (see resources)
var placeholderImage = 'mcr.microsoft.com/dotnet/samples:aspnetapp'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-kloss-${environmentName}'
  location: location
  tags: tags
}

// keep the image `azd deploy` shipped when provisioning again
module current 'modules/fetch-image.bicep' = if (klossExists) {
  name: 'kloss-current-image'
  scope: rg
  params: { name: appName }
}

module resources 'modules/resources.bicep' = {
  name: 'kloss-resources'
  scope: rg
  params: {
    environmentName: environmentName
    location: location
    tags: tags
    image: klossExists ? current!.outputs.image : placeholderImage
    klossPassword: klossPassword
    klossAdminPassword: klossAdminPassword
    klossTokenSecret: klossTokenSecret
    sessionIdle: sessionIdle
    mcpOnStart: mcpOnStart
  }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = resources.outputs.registryLoginServer
output AZURE_CONTAINER_REGISTRY_NAME string = resources.outputs.registryName
output SERVICE_KLOSS_NAME string = resources.outputs.appName
output SERVICE_KLOSS_URL string = resources.outputs.appUrl
output KLOSS_URL string = resources.outputs.appUrl
