import { describe, it, expect } from 'vitest'
import { templateCategory } from './template-category'

describe('templateCategory — conformidade Meta (categoriza templates reais)', () => {
  it('AUTH: OTP/login sempre isento', () => {
    expect(templateCategory('pt_portal_otp')).toBe('auth')
  })

  it('UTILITY: updates transacionais da OS do cliente', () => {
    const utility = [
      'pontualtech_status_os', 'pt_status_os_v3',
      'pontualtech_orcamento', 'pt_orcamento_v2',
      'pontualtech_pronto', 'pt_pronto_v2',
      'pt_coleta_v2',
      'pt_cobranca_v2', 'pt_cobranca_v3',
      'pt_os_aberta_v2',
      'pt_a_caminho_v1', 'pt_a_caminho_v3',
      'pt_rota_iniciada_v1',
      'pt_avaliacao_google_v6', // 2026-06-22: feedback NEUTRO (Meta classificou UTILITY)
    ]
    for (const t of utility) expect(templateCategory(t), t).toBe('utility')
  })

  it('MARKETING: nurture, avaliacao/feedback, follow-up de re-engajamento', () => {
    const marketing = [
      'nurture_d1_empathy', 'nurture_d7_checkin', 'nurture_d45_pesquisa',
      'pt_followup_v2',
      'pt_avaliacao_google_v1', 'pt_avaliacao_google_v2', 'pt_avaliacao_google_v3',
      'pt_avaliacao_google_v5', // lidera com cupom 10% — Meta=MARKETING (so v6 e utility)
      'pt_feedback_v1',
    ]
    for (const t of marketing) expect(templateCategory(t), t).toBe('marketing')
  })

  it('default CONSERVADOR: nome desconhecido = marketing (fica OFF)', () => {
    expect(templateCategory('promo_natal_2026')).toBe('marketing')
    expect(templateCategory('')).toBe('marketing')
    expect(templateCategory(null)).toBe('marketing')
  })
})
