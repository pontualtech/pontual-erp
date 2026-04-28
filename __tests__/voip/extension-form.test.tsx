import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExtensionForm } from "@/app/(super-admin)/voip/_components/extension-form";

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/api/super-admin/companies")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: "co-1", name: "PontualTech" }] }),
      });
    }
    if (url.includes("/api/super-admin/users")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: "u-1", name: "Karlão", email: "k@x.com" }] }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
});

describe("ExtensionForm — F1 range 100-109", () => {
  it("renderiza com defaults da Fase 1", async () => {
    renderWithProviders(<ExtensionForm onSuccess={() => {}} />);
    expect(await screen.findByText(/Faixa permitida na Fase 1: 100 a 109/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Criar Ramal/i })).toBeInTheDocument();
  });

  it("rejeita ramal fora do range (ex: 200)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExtensionForm onSuccess={() => {}} />);

    await user.click(await screen.findByLabelText(/Empresa$/i));
    await user.click(await screen.findByRole("option", { name: /PontualTech/i }));

    await user.type(screen.getByPlaceholderText("100"), "200");
    await user.type(screen.getByPlaceholderText("João — Atendimento"), "Teste");

    await user.click(screen.getByRole("button", { name: /Criar Ramal/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Na Fase 1, apenas ramais de 100 a 109 são permitidos\./i)
      ).toBeInTheDocument();
    });
  });

  it("rejeita ramal abaixo do range (ex: 099)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ExtensionForm onSuccess={() => {}} />);

    await user.click(await screen.findByLabelText(/Empresa$/i));
    await user.click(await screen.findByRole("option", { name: /PontualTech/i }));

    await user.type(screen.getByPlaceholderText("100"), "099");
    await user.type(screen.getByPlaceholderText("João — Atendimento"), "Teste");

    await user.click(screen.getByRole("button", { name: /Criar Ramal/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Na Fase 1, apenas ramais de 100 a 109 são permitidos\./i)
      ).toBeInTheDocument();
    });
  });

  it("aceita ramal 105 (no range) e chama onSuccess com o secret one-time retornado", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes("/api/super-admin/companies")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ id: "co-1", name: "PontualTech" }] }),
        });
      }
      if (url.includes("/api/super-admin/users")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      if (url === "/api/voip/extensions" && opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "ext-105",
              number: "105",
              secret: "abc123XYZ-secret-one-time-32chars",
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    renderWithProviders(<ExtensionForm onSuccess={onSuccess} />);

    await user.click(await screen.findByLabelText(/Empresa$/i));
    await user.click(await screen.findByRole("option", { name: /PontualTech/i }));

    await user.type(screen.getByPlaceholderText("100"), "105");
    await user.type(screen.getByPlaceholderText("João — Atendimento"), "Karlão Teste");

    await user.click(screen.getByRole("button", { name: /Criar Ramal/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith("abc123XYZ-secret-one-time-32chars");
    });
  });

  it("em modo edit, campos número e empresa estão desabilitados (imutáveis)", async () => {
    const initial = {
      id: "ext-1",
      companyId: "co-1",
      number: "100",
      displayName: "João",
      userId: null,
      context: "from-pontualtech",
      tenantTag: "pontualtech",
      status: "ACTIVE" as const,
      maxContacts: 2,
      callLimit: null,
      codecs: ["ulaw", "alaw"],
      dtmfMode: "rfc4733",
    };

    renderWithProviders(<ExtensionForm initial={initial} onSuccess={() => {}} />);

    const numberField = await screen.findByPlaceholderText("100");
    expect(numberField).toBeDisabled();

    expect(screen.getByRole("button", { name: /Salvar Alterações/i })).toBeInTheDocument();
  });
});