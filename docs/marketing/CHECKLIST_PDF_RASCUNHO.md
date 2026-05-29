# Checklist Mensal de Manutenção — Rascunho pra Diagramação PDF

**Objetivo:** PDF de 1 página (frente) ou 2 páginas (frente+verso), formato A4, pra anexar nos emails de welcome series do bot_abandono e listar em landing pages.

**Salvar em:** `apps/web/public/marketing/checklist-impressora-pontualtech.pdf` (servido em `https://erp.pontualtech.work/marketing/checklist-impressora-pontualtech.pdf`)

**Tools sugeridas:** Canva (templates A4), Figma, ou Google Docs export PDF.

---

## ESTRUTURA VISUAL SUGERIDA (1 página A4)

```
┌──────────────────────────────────────────────┐
│  [LOGO PONTUALTECH GRANDE]                   │
│                                              │
│  CHECKLIST MENSAL DE MANUTENÇÃO              │
│  pra sua impressora durar muito mais         │
│                                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│  IMPRESSORAS JATO E LASER                    │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                              │
│  ✓ 1. Limpe os rolos de tração com pano     │
│       levemente úmido (impressora            │
│       desligada da tomada).                  │
│                                              │
│  ✓ 2. Verifique nível dos cartuchos/        │
│       toners — não deixe secar.              │
│                                              │
│  ✓ 3. Imprima 1 página de teste por         │
│       semana (mesmo sem usar) — evita        │
│       bico seco.                             │
│                                              │
│  ✓ 4. Aspire a parte interna (bocal fino,   │
│       1× por mês).                           │
│                                              │
│  ✓ 5. Confira se há papel preso (mesmo      │
│       se a impressora não acusou).           │
│                                              │
│  ✓ 6. Atualize o driver no site do          │
│       fabricante (a cada 2-3 meses).         │
│                                              │
│  ✓ 7. Use papel de boa qualidade —          │
│       papel ruim danifica os rolos.          │
│                                              │
│  ✓ 8. Desligue na tomada por 30s a cada     │
│       15 dias (reset elétrico).              │
│                                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│  IMPRESSORAS TÉRMICAS (PDV / CUPOM FISCAL)   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                              │
│  ★ Limpe a cabeça térmica MENSALMENTE com   │
│    álcool isopropílico (NUNCA álcool         │
│    comum — derrete o componente).            │
│                                              │
│  ★ Use SEMPRE bobinas de boa qualidade —    │
│    papel ruim queima a cabeça (peça cara).   │
│                                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│                                              │
│  💡 QUANDO O CHECKLIST NÃO RESOLVE           │
│                                              │
│  Mancha estranha · ruído metálico · parar   │
│  de imprimir após cuidados → manda mensagem  │
│  pra gente. Diagnóstico gratuito.            │
│                                              │
│  📱 WhatsApp (11) 96576-0126                 │
│  🌐 pontualtech.com.br                       │
│  📍 Vila Mariana · Mooca · São Paulo         │
│                                              │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│  PontualTech · Técnicos especializados em    │
│  conserto de impressoras, notebooks e        │
│  impressoras térmicas.                       │
└──────────────────────────────────────────────┘
```

---

## VARIANTE 2 PÁGINAS (mais didática)

### Página 1 — Checklist Jato/Laser (itens 1-8)
- Header com logo
- Subtítulo "IMPRESSORAS JATO E LASER"
- 8 itens em formato de checklist com checkbox visual
- Ícones por item (gota d'água pra cartucho, engrenagem pra driver, etc)
- Footer: "Vire o PDF →" pra continuar

### Página 2 — Térmica + Apresentação + CTA
- Header consistente
- Subtítulo "IMPRESSORAS TÉRMICAS (PDV)"
- 2 itens estrela
- Box "Quem somos" com 3 serviços (impressoras + notebooks + térmicas)
- Box "Quando ajuda profissional" com WhatsApp grande + endereços

---

## DIRETRIZES DE DESIGN (sugestão Canva/Figma)

**Cores PontualTech (extraídas do site):**
- Azul principal: `#1e3a8a`
- Azul claro (acentos): `#dbeafe`
- Amarelo (alertas térmica): `#fef3c7` + `#92400e`
- Cinza texto: `#374151`
- Fundo branco

**Fontes:**
- Heading: Arial Bold (acessível em todo lugar) ou Inter Bold (mais moderno)
- Body: Arial Regular ou Inter Regular

**Imagens sugeridas (Unsplash/Pexels free):**
- Header: foto profissional de mãos consertando impressora
- Itens: ícones flat coloridos (Iconify lucide ou similar)
- Footer: foto pequena da unidade física (se tiver) OU mockup

---

## TEXTO ALTERNATIVO PRA IMAGENS (acessibilidade)

Se incluir imagens, descreva:
- Header img: "Técnico PontualTech consertando impressora em bancada profissional"
- Logo: "Logo PontualTech — fundo azul, letras brancas"

---

## ONDE USAR ESSE PDF

1. **Anexo no email D0** do journey `bot_abandono` (template `bot_abandono_d0_checklist.html`)
2. **Link no body** dos emails subsequentes ("releia o checklist")
3. **Landing page** pontualtech.com.br/checklist
4. **Footer dos sites** PT com link de download
5. **Imprimir e distribuir** nas duas unidades físicas

---

## CHECKLIST PRA REVISAR ANTES DE PUBLICAR

- [ ] Logo PontualTech consistente com identidade visual atual
- [ ] WhatsApp (11) 96576-0126 conferido (caso tenha mudado)
- [ ] Endereços Vila Mariana e Mooca atualizados
- [ ] Todas as 8 + 2 dicas técnicas revisadas por técnico (Karlão)
- [ ] Sem dado pessoal de terceiros nas fotos
- [ ] Tamanho final do PDF < 2MB (limite anexo email)
- [ ] Versão final salva como `checklist-impressora-pontualtech-v1.pdf`

---

## VERSÕES FUTURAS

- v2: Adicionar QR Code apontando pro WhatsApp (escanear no físico)
- v3: Versão em inglês pra clientes corporativos multinacionais
- v4: Variante específica B2B (parques de impressoras)
