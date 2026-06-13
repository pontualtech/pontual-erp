import { describe, it, expect } from 'vitest'
import {
  ALL_WIDGET_IDS,
  MANAGEMENT_WIDGET_IDS,
  defaultAllowedForRole,
  resolveAllowedWidgets,
  isAdminLikeRole,
} from './widget-catalog'

describe('isAdminLikeRole', () => {
  it('reconhece admin/administrador', () => {
    expect(isAdminLikeRole('role-admin')).toBe(true)
    expect(isAdminLikeRole('Administrador')).toBe(true)
  })
  it('operacionais não são admin', () => {
    expect(isAdminLikeRole('role-atendente')).toBe(false)
    expect(isAdminLikeRole('role-tecnico')).toBe(false)
    expect(isAdminLikeRole(null)).toBe(false)
  })
})

describe('defaultAllowedForRole — seed sensato', () => {
  it('atendente perde os blocos gerenciais', () => {
    const allowed = defaultAllowedForRole('role-atendente')
    for (const m of MANAGEMENT_WIDGET_IDS) expect(allowed).not.toContain(m)
    expect(allowed).toContain('summary_cards')
    expect(allowed).toContain('chart_pipeline')
    expect(allowed).toContain('recent_os')
  })
  it('financeiro vê tudo menos marketing', () => {
    const allowed = defaultAllowedForRole('role-financeiro')
    expect(allowed).toContain('receivables')
    expect(allowed).toContain('charges_summary')
    expect(allowed).not.toContain('marketing_card')
  })
  it('admin vê tudo', () => {
    expect(defaultAllowedForRole('role-admin').sort()).toEqual([...ALL_WIDGET_IDS].sort())
  })
})

describe('resolveAllowedWidgets — gate por perfil', () => {
  it('admin-like sempre vê tudo, ignorando setting', () => {
    const setting = { 'role-admin': { tech_workload: false } }
    expect(resolveAllowedWidgets('role-admin', setting).sort()).toEqual([...ALL_WIDGET_IDS].sort())
  })
  it('superAdmin sempre vê tudo', () => {
    expect(resolveAllowedWidgets('role-atendente', {}, { isSuperAdmin: true }).sort())
      .toEqual([...ALL_WIDGET_IDS].sort())
  })
  it('sem setting → cai no default do perfil', () => {
    const allowed = resolveAllowedWidgets('role-atendente', null)
    expect(allowed).not.toContain('tech_workload')
    expect(allowed).toContain('summary_cards')
  })
  it('admin pode RE-LIBERAR um gerencial pro atendente', () => {
    const setting = { 'role-atendente': { tech_workload: true } }
    expect(resolveAllowedWidgets('role-atendente', setting)).toContain('tech_workload')
  })
  it('admin pode ESCONDER um operacional do atendente', () => {
    const setting = { 'role-atendente': { chart_pipeline: false } }
    expect(resolveAllowedWidgets('role-atendente', setting)).not.toContain('chart_pipeline')
  })
  it('role desconhecido → trata como operacional (esconde gerenciais)', () => {
    const allowed = resolveAllowedWidgets('role-xyz', {})
    for (const m of MANAGEMENT_WIDGET_IDS) expect(allowed).not.toContain(m)
  })
})
