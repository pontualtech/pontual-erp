import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AsteriskHealthPage from "@/app/(super-admin)/voip/asterisk/page";

// Mock toast (sonner) — capturamos as chamadas
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock useUser — sempre super admin neste suite
vi.mock("@/lib/hooks/use-user", () => ({
  useUser: () => ({ isLoading: false, isSuperAdmin: true, id: "u-test", email: "k@x.com" }),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function renderWithProviders(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchInterval: false }, // desliga polling no test
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const HEALTH_OK = {
  data: {
    reachable: true,
    status: 200,
    asteriskVersion: "20.5.2",
    uptimeSeconds: 90061, // 1d 1h 1m
    activeChannels: 0,
    registeredEndpoints: 2,
    totalEndpoints: 10,
  },
};

const HEALTH_OFFLINE = {
  data: {
    reachable: false,
    status: 503,
    message: "ARI unreachable",
  },
};

const AUDIT_OK = {
  data: [
    {
      id: "audit-1",
      action: "config.regenerated",
      entityType: "asterisk_config",
      createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      actor: { id: "u-1", name: "Karlão", email: "k@x.com" },
      diff: { providers: 1, extensions: 5 },
    },
  ],
};

beforeEach(() => {
  mockFetch.mockReset();
  const { toast } = require("sonner");
  toast.success.mockReset();
  toast.error.mockReset();
});

function setupHappyPath(extra?: { regenerateOk?: boolean }) {
  mockFetch.mockImplementation((url: string, opts?: RequestInit) => {
    if (url.includes("/api/voip/asterisk/health")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(HEALTH_OK),
      });
    }
    if (url.includes("/api/voip/audit-log")) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(AUDIT_OK) });
    }
    if (url.includes("/api/voip/asterisk/regenerate-config") && opts?.method === "POST") {
      if (extra?.regenerateOk === false) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: () =>
            Promise.resolve({
              error: { code: "REGENERATE_FAILED", message: "Asterisk container unreachable" },
            }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: { filesWritten: 5, reloaded: true, providersCount: 1, extensionsCount: 5 },
          }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  });
}

describe("AsteriskHealthPage", () => {
  it("renderiza healthcheck card e cards de stats com dados do mock", async () => {
    setupHappyPath();
    renderWithProviders(<AsteriskHealthPage />);

    expect(await screen.findByRole("heading", { name: /Asterisk PBX/i })).toBeInTheDocument();
    // HealthBadge ARIA label inclui "Online"
    expect(await screen.findByRole("status")).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Online"),
    );
    // Stats
    expect(await screen.findByText("20.5.2")).toBeInTheDocument();
    expect(screen.getByText(/2 \/ 10/)).toBeInTheDocument(); // ramais registrados / total
    // Uptime formatado
    expect(screen.getByText(/1d 1h 1m/)).toBeInTheDocument();
  });

  it("mostra status Offline quando endpoint retorna reachable=false", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/voip/asterisk/health")) {
        return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve(HEALTH_OFFLINE) });
      }
      if (url.includes("/api/voip/audit-log")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    renderWithProviders(<AsteriskHealthPage />);

    await waitFor(() => {
      const status = screen.getByRole("status");
      expect(status.getAttribute("aria-label")).toMatch(/Offline/i);
    });
  });

  it("clique em Regenerar abre AlertDialog de confirmação", async () => {
    setupHappyPath();
    const user = userEvent.setup();
    renderWithProviders(<AsteriskHealthPage />);

    const button = await screen.findByRole("button", { name: /Regenerar Configuração Agora/i });
    await user.click(button);

    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/Tem certeza\?/i)).toBeInTheDocument();
    expect(screen.getByText(/pode interromper chamadas/i)).toBeInTheDocument();
  });

  it("confirmação dispara POST e mostra toast de sucesso", async () => {
    setupHappyPath({ regenerateOk: true });
    const user = userEvent.setup();
    renderWithProviders(<AsteriskHealthPage />);

    await user.click(await screen.findByRole("button", { name: /Regenerar Configuração Agora/i }));
    await user.click(await screen.findByRole("button", { name: /^Sim, regenerar$/i }));

    const { toast } = await import("sonner");
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringMatching(/regenerada e Asterisk recarregado/i),
        expect.objectContaining({ description: expect.stringMatching(/5 arquivo/) }),
      );
    });
  });

  it("erro no POST mostra toast vermelho com detalhe do error.code/message", async () => {
    setupHappyPath({ regenerateOk: false });
    const user = userEvent.setup();
    renderWithProviders(<AsteriskHealthPage />);

    await user.click(await screen.findByRole("button", { name: /Regenerar Configuração Agora/i }));
    await user.click(await screen.findByRole("button", { name: /^Sim, regenerar$/i }));

    const { toast } = await import("sonner");
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/Falha ao regenerar/i),
        expect.objectContaining({
          description: expect.stringMatching(/REGENERATE_FAILED.*Asterisk container unreachable/i),
        }),
      );
    });
  });

  it("renderiza última regeneração quando audit-log retorna 1 entry", async () => {
    setupHappyPath();
    renderWithProviders(<AsteriskHealthPage />);

    expect(await screen.findByText(/por.*Karlão/i)).toBeInTheDocument();
    expect(screen.getByText(/há \d+min/i)).toBeInTheDocument();
  });

  it("renderiza 'Nenhum registro ainda' quando audit-log volta vazio", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("/api/voip/asterisk/health")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(HEALTH_OK) });
      }
      if (url.includes("/api/voip/audit-log")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: [] }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });

    renderWithProviders(<AsteriskHealthPage />);

    expect(await screen.findByText(/Nenhum registro ainda/i)).toBeInTheDocument();
  });
});