import { describe, it, expect } from 'vitest'
import { crossReferralSuspenso, UNIDADES_FECHADAS } from './cross-referral'

const PT = 'pontualtech-001'
const IMP = '86c829cf-32ed-4e40-80cd-59ce4178aa1a'

// Caso Silvina (PT conv 23489, 16/10/2026 14:28): a loja Imprimitech (Vila California)
// está fechada desde 15/10, mas o ERP seguia injetando [CROSS_REFERRAL_INFO ... indique a
// outra unidade] e a Ana mandou a cliente para a Rua Paranaubis — ela ficou no portão fechado.
describe('crossReferralSuspenso — não indicar unidade com a loja fechada', () => {
  it('suspende quando a unidade-par está fechada (Ana PT não indica a IMP)', () => {
    expect(crossReferralSuspenso(PT, IMP, [IMP])).toBe(true)
  })
  it('suspende quando a própria unidade está fechada (Grazi IMP não se oferece)', () => {
    expect(crossReferralSuspenso(IMP, PT, [IMP])).toBe(true)
  })
  it('mantém o cross-referral quando as duas unidades estão abertas', () => {
    expect(crossReferralSuspenso(PT, IMP, [])).toBe(false)
    expect(crossReferralSuspenso(IMP, PT, [])).toBe(false)
  })
  it('lista oficial: Imprimitech fechada (Karlão 15/10) — tirar daqui quando reabrir', () => {
    expect(UNIDADES_FECHADAS).toContain(IMP)
    expect(UNIDADES_FECHADAS).not.toContain(PT)
  })
})
