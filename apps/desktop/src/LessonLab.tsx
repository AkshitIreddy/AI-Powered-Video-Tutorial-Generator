import { useState } from "react";
import { ArrowRight, Braces, Check, Play, RotateCcw } from "lucide-react";

/** A small, explicitly authored lesson, not a preview of generated output. */
export function LessonLab() {
  const [beat, setBeat] = useState(0);
  const values = [3, 8, 12, 17, 24, 31, 42];
  const steps = [
    { title: "Where is 24 hiding?", copy: "A sorted list lets us ask a better question.", low: 0, high: 6, mid: -1 },
    { title: "Start in the middle.", copy: "17 is less than 24. Everything to its left is too small.", low: 0, high: 6, mid: 3 },
    { title: "Keep the useful half.", copy: "31 is greater than 24. Look to the left of 31.", low: 4, high: 6, mid: 5 },
    { title: "Found in three checks.", copy: "Each comparison removes possibilities. That is binary search.", low: 4, high: 4, mid: 4 },
  ];
  const step = steps[beat]!;
  return <section className="lesson-lab" aria-label="Interactive binary search example">
    <div className="lesson-lab__mast"><span><Braces size={15} /> THE EXPLANATION LAB</span><span>Authored example</span></div>
    <div className="lesson-lab__stage" aria-live="polite">
      <span className="lesson-lab__topic">Computer science / a little intuition</span>
      <h2>{step.title}</h2>
      <div className="lesson-lab__array">{values.map((value, index) => <span key={value} className={`${index < step.low || index > step.high ? "discarded" : ""} ${index === step.mid ? "checking" : ""} ${beat === 3 && value === 24 ? "found" : ""}`}><small>{index}</small><b>{value}</b>{index === step.mid && <i>{beat === 3 ? <Check size={14} /> : "↑"}</i>}</span>)}</div>
      <p>{step.copy}</p>
    </div>
    <div className="lesson-lab__controls"><div role="group" aria-label="Example steps">{steps.map((_, index) => <button key={index} aria-label={`Example step ${index + 1}`} aria-pressed={index === beat} onClick={() => setBeat(index)} />)}</div><button onClick={() => setBeat((beat + 1) % steps.length)}>{beat === 0 ? <Play size={13} /> : beat === 3 ? <RotateCcw size={13} /> : <ArrowRight size={13} />}{beat === 0 ? "Try the explanation" : beat === 3 ? "Play again" : "Next thought"}</button></div>
  </section>;
}
