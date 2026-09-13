export function el (tag, attributes = {}, children = []) {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'className') node.className = value
    else if (key === 'text') node.textContent = value
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value)
    else if (key === 'checked' || key === 'disabled' || key === 'selected') node[key] = Boolean(value)
    else if (key === 'value') node.value = value
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  const list = Array.isArray(children) ? children : [children]
  for (const child of list.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

export function button (label, { variant = 'secondary', ...attributes } = {}) {
  return el('button', { type: 'button', className: `button button-${variant}`, ...attributes }, label)
}

export function badge (label, tone = 'neutral') {
  return el('span', { className: `badge badge-${tone}`, text: label })
}

export function field (label, control, description) {
  const id = control.id || `field-${Math.random().toString(36).slice(2)}`
  control.id = id
  if (description) control.setAttribute('aria-describedby', `${id}-help`)
  return el('div', { className: 'field' }, [
    el('label', { for: id, text: label }),
    description ? el('p', { className: 'field-help', id: `${id}-help`, text: description }) : null,
    control
  ])
}

export function formatDate (value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(date)
}

export function emptyState (title, description, action) {
  return el('div', { className: 'empty-state' }, [
    el('div', { className: 'empty-icon', text: '◇' }),
    el('h2', { text: title }),
    el('p', { text: description }),
    action
  ])
}

export function errorState (error, retry) {
  const details = Array.isArray(error?.details)
    ? el('ul', { className: 'error-details' }, error.details.map((item) => el('li', { text: `${item.path || 'campo'}: ${item.message || item}` })))
    : null
  return el('div', { className: 'notice notice-danger' }, [
    el('strong', { text: 'Não foi possível concluir.' }),
    el('p', { text: error?.message || 'Erro inesperado.' }),
    details,
    retry ? button('Tentar novamente', { onClick: retry }) : null
  ])
}

export function loading (label = 'Carregando…') {
  return el('div', { className: 'loading' }, [el('span', { className: 'spinner' }), label])
}

export function notify (message, tone = 'success') {
  window.dispatchEvent(new CustomEvent('panel:notify', { detail: { message, tone } }))
}

export function setPageHeader ({ eyebrow, title, description, actions = [] }) {
  document.querySelector('#page-eyebrow').textContent = eyebrow
  document.querySelector('#page-title').textContent = title
  document.querySelector('#page-description').textContent = description
  document.querySelector('#page-actions').replaceChildren(...actions)
  document.title = `${title} · LCN`
}

export function setBusy (control, busy, busyLabel = 'Aguarde…') {
  if (!control) return
  if (busy) {
    control.dataset.originalLabel = control.textContent
    control.textContent = busyLabel
    control.disabled = true
  } else {
    control.textContent = control.dataset.originalLabel || control.textContent
    control.disabled = false
  }
}

// Copiar para a área de transferência. O caminho moderno (navigator.clipboard)
// só existe em contexto seguro — o painel roda em http://127.0.0.1, que os
// navegadores tratam como seguro, mas o fallback cobre quem abrir por outro
// endereço.
export async function copyText (text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const area = el('textarea', { value: text, 'aria-hidden': 'true' })
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.append(area)
  area.select()
  document.execCommand('copy')
  area.remove()
}
