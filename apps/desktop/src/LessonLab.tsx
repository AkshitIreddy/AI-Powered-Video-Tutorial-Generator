import { useState } from "react";
import { ArrowRight, BookOpen, FileText, Layers3, Play, RotateCcw, Sparkles } from "lucide-react";

/** Explain the workflow without prescribing a topic or pretending work exists. */
export function LessonLab() {
  const [beat, setBeat] = useState(0);
  const steps = [
    { title: "Start with your question.", copy: "Bring the idea you want to explain, in your own words.", label: "Your idea", icon: Sparkles },
    { title: "Give it a foundation.", copy: "Add your sources and review the learning plan before generation.", label: "Your sources", icon: FileText },
    { title: "Choose how to teach it.", copy: "Pick your visual style and presenters, then shape each scene.", label: "Your scenes", icon: Layers3 },
    { title: "Make it yours.", copy: "Review the video, refine the timing, and export your finished lesson.", label: "Your lesson", icon: Play },
  ];
  const step = steps[beat]!;
  return <section className="lesson-lab" aria-label="How your tutorial takes shape">
    <div className="lesson-lab__mast"><span><BookOpen size={15} /> FROM IDEA TO LESSON</span><span>Your creative process</span></div>
    <div className="lesson-lab__stage" aria-live="polite">
      <span className="lesson-lab__topic">Your subject. Your point of view.</span>
      <h2>{step.title}</h2>
      <div className="lesson-lab__workflow">{steps.map(({ label, icon: Icon }, index) => <span key={label} className={index === beat ? "active" : ""}><Icon size={24} /><small>{label}</small></span>)}</div>
      <p>{step.copy}</p>
    </div>
    <div className="lesson-lab__controls"><div role="group" aria-label="Workflow stages">{steps.map(({ label }, index) => <button key={label} aria-label={label} aria-pressed={index === beat} onClick={() => setBeat(index)} />)}</div><button onClick={() => setBeat((beat + 1) % steps.length)}>{beat === 3 ? <RotateCcw size={13} /> : <ArrowRight size={13} />}{beat === 3 ? "Back to the idea" : "Next stage"}</button></div>
  </section>;
}
