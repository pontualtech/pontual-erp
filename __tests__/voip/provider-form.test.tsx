import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProviderForm } from "@/app/(super-admin)/voip/_components/provider-form";

// Mock global fetch
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
  // Default: companies list
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/api/super-admin/companies")) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { id: "co-1", name: "PontualTech" },
              { id: "co-2", name: "Imprimitech" },
            ],
          }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
});

describe("ProviderForm", () => {
  it("renderiza campos básicos e botão de submit", async () => {
    renderWithProviders(<ProviderForm onSuccess={() => {}} />);

    expect(await screen.findByText(/Nome do Provedor/i)).toBeInTheDocument();
    expect(screen.getByText(/Host de Saída/i)).toBeInTheDocument();
    expect(screen.getByText(/Porta/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Criar Provedor/i })).toBeInTheDocument();
  });

  it("mostra campo matchIp quando authMethod=IP_BASED (default)", async () => {
    renderWithProviders(<ProviderForm onSuccess={() => {}} />);
    expect(await screen.findByText(/IP \/ CIDR Autorizado/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Senha$/i)).not.toBeInTheDocument();
  });

  it("mostra erros de validação Zod quando submetido vazio", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProviderForm onSuccess={() => {}} />);

    const submit = await screen.findByRole("button", { name: /Criar Provedor/i });
    await user.click(submit);

    // Zod errors aparecem nos FormMessage (refine ou required)
    await waitFor(() => {
      const errorEls = screen.getAllByRole("alert");
      expect(errorEls.length).toBeGreaterThan(0);
    });
  });

  it("toggle de mostrar senha alterna type do input", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProviderForm onSuccess={() => {}} />);

    // Trocar para USER_SECRET
    const authSelect = await screen.findByLabelText(/Método de Autenticação/i);
    await user.click(authSelect);
    const userPwOption = await screen.findByRole("option", { name: /Usuário e senha/i });
    await user.click(userPwOption);

    const pwField = await screen.findByLabelText(/^Senha$/i);
    expect(pwField).toHaveAttribute("type", "password");

    const toggle = screen.getByRole("button", { name: /Mostrar senha/i });
    await user.click(toggle);

    expect(pwField).toHaveAttribute("type", "text");
  });

  it("mapeia erro server-side (details) para FormMessage do campo correspondente", async () => {
    const user = userEvent.setup();

    mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url.includes("/api/super-admin/companies")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [{ id: "co-1", name: "PontualTech" }] }),
        });
      }
      if (url === "/api/voip/providers" && opts?.method === "POST") {
        return Promise.resolve({
          ok: false,
          json: () =>
            Promise.resolve({
              error: "Falha de validação",
              details: { hostOutbound: ["Host inválido — domínio inexistente."] },
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    const onSuccess = vi.fn();
    renderWithProviders(<ProviderForm onSuccess={onSuccess} />);

    // Preenche o mínimo
    await user.click(await screen.findByLabelText(/Empresa$/i));
    await user.click(await screen.findByRole("option", { name: /PontualTech/i }));

    await user.type(screen.getByPlaceholderText("Sonax PontualTech"), "Sonax Test");
    await user.type(screen.getByPlaceholderText("proxy.sonavoip.com.br"), "host.invalido");
    await user.type(screen.getByPlaceholderText("from-sonax-pontualtech"), "from-test");
    await user.type(screen.getByPlaceholderText("200.123.45.67 ou 200.123.45.0/24"), "1.2.3.4");

    await user.click(screen.getByRole("button", { name: /Criar Provedor/i }));

    await waitFor(() => {
      expect(screen.getByText(/Host inválido — domínio inexistente\./)).toBeInTheDocument();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});