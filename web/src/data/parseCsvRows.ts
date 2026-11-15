export function parseCsvRows(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let state: "START" | "PLAIN" | "QUOTED" | "AFTER_QUOTE" = "START";

  function finishField() {
    row.push(field);
    field = "";
    state = "START";
  }

  function finishRow() {
    finishField();
    rows.push(row);
    row = [];
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (state === "QUOTED") {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          state = "AFTER_QUOTE";
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === ",") {
      finishField();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      finishRow();
    } else if (character === '"' && state === "START") {
      state = "QUOTED";
    } else if (state === "AFTER_QUOTE" && character !== " " && character !== "\t") {
      throw new Error(`Invalid CSV quoting near row ${rows.length + 1}.`);
    } else if (character === '"') {
      throw new Error(`Invalid CSV quoting near row ${rows.length + 1}.`);
    } else if (state !== "AFTER_QUOTE") {
      field += character;
      state = "PLAIN";
    }
  }

  if (state === "QUOTED") throw new Error("CSV has an unclosed quoted field.");
  if (row.length > 0 || field !== "" || state === "AFTER_QUOTE") finishRow();
  return rows;
}
