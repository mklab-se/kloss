// Reads the image the kloss Container App runs now, so provisioning again keeps what
// `azd deploy` shipped. It has to be its own module: one template cannot read and write the
// same resource (Azure calls it a circular dependency).
param name string

resource app 'Microsoft.App/containerApps@2024-03-01' existing = {
  name: name
}

output image string = app.properties.template.containers[0].image
