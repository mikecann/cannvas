import type { Dispatch, SetStateAction } from "react";

type TouchKeyboardProps = {
  mode?: "letters" | "decimal";
  onChange: Dispatch<SetStateAction<string>>;
};

const LETTER_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

export function TouchKeyboard({ mode = "letters", onChange }: TouchKeyboardProps) {
  const appendLetter = (letter: string) => {
    onChange((current) => current + (current.length === 0 ? letter : letter.toLowerCase()));
  };
  const erase = () => onChange((current) => current.slice(0, -1));

  if (mode === "decimal") {
    return (
      <div className="touch-keyboard numeric-keyboard" aria-label="Number keyboard">
        <div className="touch-keyboard-row">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((key) => (
            <button type="button" key={key} onClick={() => onChange((current) => current + key)}>{key}</button>
          ))}
        </div>
        <div className="touch-keyboard-row compact-row">
          <button type="button" onClick={() => onChange((current) => current.includes(".") ? current : `${current}.`)}>.</button>
          <button type="button" className="keyboard-wide-key" onClick={erase}>⌫ Delete</button>
        </div>
      </div>
    );
  }

  return (
    <div className="touch-keyboard" aria-label="Letter keyboard">
      {LETTER_ROWS.map((row) => (
        <div className="touch-keyboard-row" key={row}>
          {[...row].map((key) => (
            <button type="button" key={key} onClick={() => appendLetter(key)}>{key}</button>
          ))}
        </div>
      ))}
      <div className="touch-keyboard-row compact-row">
        <button type="button" className="keyboard-wide-key" onClick={() => onChange((current) => `${current} `)}>Space</button>
        <button type="button" className="keyboard-wide-key" onClick={erase}>⌫ Delete</button>
      </div>
    </div>
  );
}
