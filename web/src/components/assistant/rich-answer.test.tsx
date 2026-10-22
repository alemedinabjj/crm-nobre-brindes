import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RichAnswer } from "./rich-answer";

describe("RichAnswer", () => {
  it("renderiza negrito, listas e citações clicáveis", async () => {
    const onCite = vi.fn();
    render(
      <RichAnswer
        text={"Prioridades de **hoje**:\n- OPP-2002 com proposta vencida [1]\n- OPP-2003 com evento em 3 dias [2]"}
        onCite={onCite}
      />,
    );

    expect(screen.getByText("hoje").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(screen.getByRole("button", { name: "Ver fonte 2" }));
    expect(onCite).toHaveBeenCalledWith(2);
  });

  it("nunca interpreta HTML vindo do modelo", () => {
    const { container } = render(
      <RichAnswer text={'<img src=x onerror="alert(1)"> <script>alert(1)</script> texto'} onCite={vi.fn()} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("mantém listas numeradas como ordenadas", () => {
    const { container } = render(<RichAnswer text={"1. Ligar\n2. Enviar proposta"} onCite={vi.fn()} />);
    expect(container.querySelector("ol")?.children).toHaveLength(2);
  });
});
