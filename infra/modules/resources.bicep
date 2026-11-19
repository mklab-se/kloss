// Everything kloss needs, in its resource group.
param environmentName string
param location string
param tags object
@description('The image to run: the current one, or a placeholder before the first deploy.')
param image string
@secure()
param klossPassword string
@secure()
param klossAdminPassword string
@secure()
param klossTokenSecret string
param sessionIdle string
param mcpOnStart bool

var token = toLower(uniqueString(subscription().id, resourceGroup().id, environmentName))
var appName = 'ca-kloss-${environmentName}'
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-kloss-${token}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'crkloss${token}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

// A Container App cannot pull with its own system identity (the role assignment would need it
// before it exists), so a user-assigned identity holds AcrPull.
resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-kloss-pull-${token}'
  location: location
  tags: tags
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: registry
  name: guid(registry.id, pullIdentity.id, acrPullRoleId)
  properties: {
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-kloss-${token}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey // the workspace ingestion key, not an app secret
      }
    }
  }
}

var secrets = concat(
  empty(klossPassword) ? [] : [{ name: 'kloss-password', value: klossPassword }],
  empty(klossAdminPassword) ? [] : [{ name: 'kloss-admin-password', value: klossAdminPassword }],
  empty(klossTokenSecret) ? [] : [{ name: 'kloss-token-secret', value: klossTokenSecret }]
)
var secretEnv = concat(
  empty(klossPassword) ? [] : [{ name: 'KLOSS_PASSWORD', secretRef: 'kloss-password' }],
  empty(klossAdminPassword) ? [] : [{ name: 'KLOSS_ADMIN_PASSWORD', secretRef: 'kloss-admin-password' }],
  empty(klossTokenSecret) ? [] : [{ name: 'KLOSS_TOKEN_SECRET', secretRef: 'kloss-token-secret' }]
)

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: union(tags, { 'azd-service-name': 'kloss' })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${pullIdentity.id}': {} }
  }
  dependsOn: [acrPull]
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      // one revision, one replica: sessions live in memory
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: pullIdentity.id
        }
      ]
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: 'kloss'
          image: image
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: concat(secretEnv, [
            { name: 'KLOSS_SESSION_IDLE', value: sessionIdle }
            { name: 'KLOSS_MCP', value: mcpOnStart ? '1' : '0' }
            { name: 'ASPNETCORE_HTTP_PORTS', value: '8080' } // only used by the placeholder image
          ])
        }
      ]
      scale: {
        // sleeps when nobody uses it; exactly one replica when it is awake
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output registryLoginServer string = registry.properties.loginServer
output registryName string = registry.name
output appName string = app.name
output appUrl string = 'https://${app.properties.configuration.ingress.fqdn}'
