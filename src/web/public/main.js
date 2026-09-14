import { renderDashboard } from './pages/dashboard.js'
import { renderInstance } from './pages/instance.js'
import { renderAutomations } from './pages/automations.js'
import { renderExecutions } from './pages/executions.js'
import { renderConnections } from './pages/connections.js'
import { renderEntities } from './pages/entities.js'
import { renderCatalog } from './pages/catalog.js'
import { renderVariables } from './pages/variables.js'
import { renderAcervo } from './pages/acervo.js'
import { button, emptyState, errorState, loading, setPageHeader } from './ui.js'

const page = document.querySelector('#page')
const toastRegion = document.querySelector('#toast-region')
let renderToken = 0

function matchRoute (pathname) {
  if (pathname === '/' || pathname === '/instances') return { render: renderDashboard, section: '/' }
  const instance = pathname.match(/^\/instances\/([^/]+)$/)
  if (instance) return { render: renderInstance, section: '/', params: { id: decodeURIComponent(instance[1]) } }
  if (pathname === '/automations') return { render: renderAutomations, section: '/automations' }
  if (pathname === '/executions') return { render: renderExecutions, section: '/executions' }
  if (pathname === '/connections') return { render: renderConnections, section: '/connections' }
  if (pathname === '/entities') return { render: renderEntities, section: '/entities' }
  if (pathname === '/catalog') return { render: renderCatalog, section: '/catalog' }
  if (pathname === '/variables') return { render: renderVariables, section: '/variables' }
  if (pathname === '/acervo') return { render: renderAcervo, section: '/acervo' }
  return null
}

function updateActiveNavigation (section) {
  for (const link of document.querySelectorAll('.main-nav a')) {
    const active = link.getAttribute('href') === section
    link.classList.toggle('active', active)
    if (active) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
}

export function navigate (to, { replace = false } = {}) {
  const url = new URL(to, window.location.origin)
  window.history[replace ? 'replaceState' : 'pushState']({}, '', `${url.pathname}${url.search}`)
  renderCurrentRoute()
}

async function renderCurrentRoute () {
  const token = ++renderToken
  const route = matchRoute(window.location.pathname)
  window.scrollTo({ top: 0, behavior: 'instant' })
  if (!route) {
    updateActiveNavigation('')
    setPageHeader({ eyebrow: 'Não encontrado', title: 'Esta página não existe', description: 'Use a navegação para voltar ao painel.' })
    page.replaceChildren(emptyState('Caminho desconhecido', window.location.pathname, button('Ir para instâncias', { variant: 'primary', onClick: () => navigate('/') })))
    return
  }

  updateActiveNavigation(route.section)
  page.replaceChildren(loading())
  try {
    const content = await route.render({
      params: route.params || {},
      query: new URLSearchParams(window.location.search),
      navigate,
      refresh: renderCurrentRoute
    })
    if (token === renderToken && content) page.replaceChildren(content)
  } catch (error) {
    if (token === renderToken) page.replaceChildren(errorState(error, renderCurrentRoute))
  }
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-link]')
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const url = new URL(link.href)
  if (url.origin !== window.location.origin) return
  event.preventDefault()
  navigate(`${url.pathname}${url.search}`)
})

window.addEventListener('popstate', renderCurrentRoute)
window.addEventListener('panel:notify', ({ detail }) => {
  const toast = document.createElement('div')
  toast.className = `toast toast-${detail.tone || 'success'}`
  toast.textContent = detail.message
  toastRegion.append(toast)
  requestAnimationFrame(() => toast.classList.add('visible'))
  window.setTimeout(() => {
    toast.classList.remove('visible')
    window.setTimeout(() => toast.remove(), 180)
  }, 4200)
})

renderCurrentRoute()
