import type { ChoreCategory } from "../data/types";

type ChoreCategoryPickerProps = {
  value: ChoreCategory;
  onChange: (category: ChoreCategory) => void;
};

export function ChoreCategoryPicker({ value, onChange }: ChoreCategoryPickerProps) {
  return (
    <fieldset className="category-picker">
      <legend>Chore category</legend>
      <div>
        <button type="button" className={value === "standard" ? "standard selected" : "standard"} aria-pressed={value === "standard"} onClick={() => onChange("standard")}>
          <strong>Standard</strong><span>Regular responsibility</span>
        </button>
        <button type="button" className={value === "bonus" ? "bonus selected" : "bonus"} aria-pressed={value === "bonus"} onClick={() => onChange("bonus")}>
          <strong>Bonus</strong><span>Extra paid job</span>
        </button>
      </div>
    </fieldset>
  );
}
