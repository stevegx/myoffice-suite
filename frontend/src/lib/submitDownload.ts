export function submitDownload(action: string, target: string, data: object) {
  const form = document.createElement('form')
  form.action = action
  form.method = 'POST'
  form.enctype = 'text/plain'
  form.target = target
  form.hidden = true
  const field = document.createElement('input')
  field.type = 'hidden'
  field.name = 'payload'
  field.value = JSON.stringify(data)
  form.append(field)
  document.body.append(form)
  form.submit()
  form.remove()
}
