/**
 * Google Analytics 4 event tracking helper
 * Envia eventos customizados para o GA4 do portal do cliente
 */

declare global {
  interface Window {
    gtag?: (...args: any[]) => void
  }
}

export function trackEvent(eventName: string, params?: Record<string, string | number | boolean>) {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', eventName, params)
  }
}

// Eventos do Portal
export const portalEvents = {
  login: (method: string) => trackEvent('portal_login', { method }),
  register: () => trackEvent('portal_register'),
  viewOS: (osNumber: number) => trackEvent('portal_view_os', { os_number: osNumber }),
  createOS: (osNumber: number) => trackEvent('portal_create_os', { os_number: osNumber }),
  approveQuote: (osNumber: number, value: number, paymentMethod: string) =>
    trackEvent('portal_approve_quote', { os_number: osNumber, value, payment_method: paymentMethod }),
  rejectQuote: (osNumber: number) => trackEvent('portal_reject_quote', { os_number: osNumber }),
  acceptDiscount: (osNumber: number, discountPercent: number) =>
    trackEvent('portal_accept_discount', { os_number: osNumber, discount_percent: discountPercent }),
  submitNPS: (osNumber: number, score: number) =>
    trackEvent('portal_nps_submit', { os_number: osNumber, score }),
  createTicket: () => trackEvent('portal_create_ticket'),
  resetPassword: () => trackEvent('portal_reset_password'),
  viewQuote: (osNumber: number) => trackEvent('portal_view_quote', { os_number: osNumber }),
}
