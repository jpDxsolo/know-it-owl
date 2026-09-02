import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamRename } from "@know-it-owl/frontend/components/TeamRename";
import { setApiConfig } from "@know-it-owl/frontend/services/config";

const ME = "p1";
let calls: { query: string; variables: Record<string, unknown> }[] = [];

function serve(options: { fails?: string } = {}): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      calls.push(body);
      if (options.fails) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            errors: [{ errorType: "ForbiddenError", message: options.fails }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { setTeamName: { gameId: "g1" } } }),
      };
    }),
  );
}

const renderRename = (name = "Team 2") =>
  render(<TeamRename gameId="g1" teamId="t1" name={name} />);

beforeEach(() => {
  calls = [];
  localStorage.clear();
  localStorage.setItem("kio.playerId", ME);
  setApiConfig({ url: "https://api.test/graphql", realtimeUrl: "wss://rt.test", apiKey: "da2-x" });
  serve();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setApiConfig(undefined);
  localStorage.clear();
});

describe("renaming a team", () => {
  it("stays out of the way until asked", () => {
    renderRename();
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("opens on the current name, so a small edit is a small edit", async () => {
    renderRename("The Night Owls");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByLabelText("Team name")).toHaveValue("The Night Owls");
  });

  it("sends the new name for this team, as this player", async () => {
    renderRename();
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    await userEvent.clear(screen.getByLabelText("Team name"));
    await userEvent.type(screen.getByLabelText("Team name"), "The Night Owls");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.query.includes("SetTeamName"))).toBe(true));
    expect(calls.find((c) => c.query.includes("SetTeamName"))?.variables).toEqual({
      gameId: "g1",
      playerId: ME,
      teamId: "t1",
      name: "The Night Owls",
    });
  });

  it("submits on Enter, because that is what a one-field form does", async () => {
    renderRename();
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    await userEvent.clear(screen.getByLabelText("Team name"));
    await userEvent.type(screen.getByLabelText("Team name"), "Quiz Khalifa{Enter}");

    await waitFor(() => expect(calls.some((c) => c.query.includes("SetTeamName"))).toBe(true));
  });

  it("trims what was typed", async () => {
    renderRename();
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    await userEvent.clear(screen.getByLabelText("Team name"));
    await userEvent.type(screen.getByLabelText("Team name"), "  Bears  ");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(calls.some((c) => c.query.includes("SetTeamName"))).toBe(true));
    const sent = calls.find((c) => c.query.includes("SetTeamName"))?.variables as { name: string };
    expect(sent.name).toBe("Bears");
  });

  it("will not outrun the server's own limit", async () => {
    renderRename();
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByLabelText("Team name")).toHaveAttribute("maxlength", "30");
  });

  it("sends nothing for a blank name or an unchanged one", async () => {
    // Both are slips rather than intentions, and each would still broadcast
    // to every device in the room.
    renderRename("Bears");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    await userEvent.clear(screen.getByLabelText("Team name"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(calls.some((c) => c.query.includes("SetTeamName"))).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(calls.some((c) => c.query.includes("SetTeamName"))).toBe(false);
  });

  it("abandons an edit on cancel, keeping the old name", async () => {
    renderRename("Bears");
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    await userEvent.clear(screen.getByLabelText("Team name"));
    await userEvent.type(screen.getByLabelText("Team name"), "Something else");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(calls.some((c) => c.query.includes("SetTeamName"))).toBe(false);
    // Re-opening starts from the real name, not the abandoned draft.
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(screen.getByLabelText("Team name")).toHaveValue("Bears");
  });

  it("keeps the field open when the server refuses, so nothing is retyped", async () => {
    serve({ fails: "Only a member of a team may rename it" });
    renderRename();
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    await userEvent.clear(screen.getByLabelText("Team name"));
    await userEvent.type(screen.getByLabelText("Team name"), "Not mine");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText(/only a member of a team may rename it/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Team name")).toHaveValue("Not mine");
  });
});
