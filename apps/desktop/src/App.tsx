import {
  Activity,
  AlignLeft,
  Archive,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  BadgeCheck,
  BookOpen,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  CircleHelp,
  Clock3,
  Cloud,
  Cpu,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Film,
  FolderClock,
  Gauge,
  Globe2,
  HardDrive,
  History,
  Home,
  Image,
  KeyRound,
  Languages,
  Layers3,
  Library,
  Link2,
  Lock,
  Menu,
  MessageSquareText,
  Mic2,
  MonitorPlay,
  Moon,
  MoreHorizontal,
  Network,
  PackageCheck,
  PanelRightClose,
  Pause,
  Play,
  PlayCircle,
  Plus,
  Presentation,
  Quote,
  Redo2,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquareStack,
  Star,
  TableProperties,
  TextCursorInput,
  TimerReset,
  Undo2,
  Upload,
  UserRoundCheck,
  Video,
  Volume2,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import alystriaMark from "./assets/alystria-mark.svg";
import { defaultSnapshot, templates } from "./data";
import {
  appBootstrap,
  desktopEnvironment,
  diagnosticsRun,
  generationApprove,
  generationStart,
  jobCancel,
  jobRetry,
  jobStatus,
  masterExport,
  projectCreate,
  projectExportArchive,
  projectOpen,
  projectHistoryRedo,
  projectHistoryUndo,
  projectSnapshotGet,
  projectSnapshotSave,
  providerSecretDelete,
  providerSecretSet,
  providerSecretStatus,
  qaRepair,
  sceneRegenerate,
  sceneRender,
  sourceImport,
  type BootstrapInfo,
  type DiagnosticReport,
  type GroundingMode,
  type JobReceipt,
  type MasterExportRequest,
  type ProviderSecretRef,
  type QualityPreset,
  type SourceImportReceipt,
} from "./native";
import { SharedScenePreview } from "./ScenePreview";
import type {
  AppSnapshot,
  GlobalArea,
  JobRecord,
  ProjectRecord,
  Scene,
  StudioMode,
  ToastMessage,
  Workspace,
} from "./types";
import { usePersistentState } from "./usePersistentState";

interface RuntimeState {
  environment: ReturnType<typeof desktopEnvironment>;
  bootstrap: BootstrapInfo | null;
  loading: boolean;
  error: string | null;
}

interface NativeJobLink {
  projectId: string;
  projectDirectory: string;
  jobId: string;
}

interface TutorialCreationSettings {
  grounding: GroundingMode;
  quality: QualityPreset;
  sourceFiles: File[];
}

const globalNav: Array<{ id: GlobalArea; label: string; icon: LucideIcon }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "projects", label: "Projects", icon: FolderClock },
  { id: "templates", label: "Templates", icon: SquareStack },
  { id: "library", label: "Library", icon: Library },
  { id: "providers", label: "Models & providers", icon: Cpu },
  { id: "diagnostics", label: "Settings & diagnostics", icon: Settings2 },
];

const projectNav: Array<{ id: Workspace; label: string; icon: LucideIcon }> = [
  { id: "plan", label: "Plan", icon: BookOpen },
  { id: "storyboard", label: "Storyboard", icon: Layers3 },
  { id: "studio", label: "Studio", icon: MonitorPlay },
  { id: "review", label: "Review", icon: BadgeCheck },
  { id: "export", label: "Export", icon: Download },
];

const providerConfigs = [
  { id: "local", name: "Local models", icon: HardDrive, detail: "Qwen · Whisper · Kokoro", tone: "teal", local: true },
  { id: "openai", name: "OpenAI", icon: Sparkles, detail: "Language · images · speech", tone: "indigo" },
  { id: "anthropic", name: "Anthropic", icon: MessageSquareText, detail: "Language and structured review", tone: "amber" },
  { id: "google", name: "Google AI", icon: Globe2, detail: "Language · images · video", tone: "neutral" },
  { id: "nvidia-nim", name: "NVIDIA NIM (dev/test)", icon: Cpu, detail: "One key · public/synthetic hosted previews · per-model checks", tone: "teal" },
  { id: "elevenlabs", name: "ElevenLabs", icon: Mic2, detail: "Voices and narration", tone: "neutral" },
  { id: "runway", name: "Runway", icon: Video, detail: "Selective generated motion", tone: "neutral" },
] satisfies Array<{ id: string; name: string; icon: LucideIcon; detail: string; tone: string; local?: boolean }>;

const SOURCE_FILE_ACCEPT = ".pdf,.docx,.pptx,.epub,.md,.markdown,.txt,.csv,.json";
const MAX_SOURCE_FILE_BYTES = 8 * 1024 * 1024;

function LogoMark() {
  return (
    <span className="logo-mark" aria-hidden="true">
      <img src={alystriaMark} alt="" />
    </span>
  );
}

function App() {
  const [snapshot, setSnapshot, resetSnapshot] = usePersistentState<AppSnapshot>("alystria-studio-v2", defaultSnapshot);
  const [runtime, setRuntime] = useState<RuntimeState>({ environment: desktopEnvironment(), bootstrap: null, loading: true, error: null });
  const [nativeJobs, setNativeJobs] = useState<Record<string, NativeJobLink>>(() => nativeJobLinks(snapshot.jobs));
  const [area, setArea] = useState<GlobalArea>("home");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [activeProjectId, setActiveProjectId] = useState(snapshot.recentProjectId);
  const [activeSceneId, setActiveSceneId] = useState("scene-insight");
  const [jobsOpen, setJobsOpen] = useState(false);
  const [newTutorialOpen, setNewTutorialOpen] = useState(false);
  const [regenScene, setRegenScene] = useState<Scene | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [commandOpen, setCommandOpen] = useState(false);
  const toastCounter = useRef(0);
  const snapshotSaveSequence = useRef(Promise.resolve());
  const durableVersionByProject = useRef(new Map<string, number>());

  const activeProject = snapshot.projects.find((project) => project.id === activeProjectId) ?? snapshot.projects[0]!;
  const activeScene = activeProject.scenes.find((scene) => scene.id === activeSceneId) ?? activeProject.scenes[0]!;

  const notify = (title: string, detail: string, tone: ToastMessage["tone"] = "success") => {
    const id = ++toastCounter.current;
    setToasts((items) => [...items, { id, title, detail, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3800);
  };

  const openProject = (projectId: string, nextWorkspace: Workspace = "plan") => {
    const project = snapshot.projects.find((item) => item.id === projectId);
    if (project?.nativeProjectDirectory && runtime.environment === "native") {
      void projectOpen({ projectDirectory: project.nativeProjectDirectory, allowReadOnly: true })
        .then(async (handle) => {
          const durable = await projectSnapshotGet({
            projectId: handle.manifest.projectId,
            projectDirectory: handle.projectDirectory,
          });
          setSnapshot((current) => ({
            ...current,
            projects: current.projects.map((item) => item.id === projectId
              ? hydrateDurableProject(item, durable.snapshot, {
                nativeProjectId: handle.manifest.projectId,
                nativeProjectDirectory: handle.projectDirectory,
                nativeHeadRevisionId: durable.headRevisionId,
                nativeRevisionNumber: durable.revisionNumber,
              })
              : item),
          }));
        })
        .catch((error: unknown) => notify("Project folder needs attention", errorMessage(error), "warning"));
    }
    setActiveProjectId(projectId);
    setSnapshot((current) => ({ ...current, recentProjectId: projectId }));
    setWorkspace(nextWorkspace);
    setMobileNavOpen(false);
  };

  const navigateGlobal = (next: GlobalArea) => {
    setArea(next);
    setWorkspace(null);
    setMobileNavOpen(false);
  };

  const setMode = (mode: StudioMode) => {
    setSnapshot((current) => ({ ...current, studioMode: mode }));
    notify(`${mode === "guided" ? "Guided" : "Studio"} mode`, mode === "guided" ? "Advanced production controls are tucked away." : "Provider, timing, and dependency controls are now visible.", "info");
  };

  const updateScene = (projectId: string, sceneId: string, update: Partial<Scene>) => {
    setSnapshot((current) => ({
      ...current,
      projects: current.projects.map((project) =>
        project.id === projectId
          ? { ...project, scenes: project.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...update } : scene)), updatedAt: "just now" }
          : project,
      ),
      version: current.version + 1,
    }));
  };

  const addJob = (job: JobRecord) => setSnapshot((current) => ({ ...current, jobs: [job, ...current.jobs] }));

  useEffect(() => {
    let active = true;
    void appBootstrap().then((bootstrap) => {
      if (active) setRuntime((current) => ({ ...current, bootstrap, loading: false, error: null }));
    }).catch((error: unknown) => {
      if (active) setRuntime((current) => ({ ...current, loading: false, error: errorMessage(error) }));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setNativeJobs(nativeJobLinks(snapshot.jobs));
  }, [snapshot.jobs]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setRegenScene(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!jobsOpen || Object.keys(nativeJobs).length === 0) return;
    let active = true;
    const refresh = async () => {
      const entries = await Promise.all(Object.entries(nativeJobs).map(async ([id, input]) => {
        try {
          return [id, await jobStatus(input)] as const;
        } catch {
          return null;
        }
      }));
      if (!active) return;
      setSnapshot((current) => ({
        ...current,
        jobs: current.jobs.map((job) => {
          const receipt = entries.find((entry) => entry?.[0] === job.id)?.[1];
          return receipt ? receiptJob(receipt, job.title, job.detail, nativeJobProject(job) ?? undefined) : job;
        }),
      }));
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 5_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [jobsOpen, nativeJobs, setSnapshot]);

  useEffect(() => {
    if (snapshot.version === 0) return;
    const project = snapshot.projects.find((item) => item.id === activeProjectId);
    if (!project?.nativeProjectId || !project.nativeProjectDirectory || !project.nativeHeadRevisionId) return;
    const savedVersion = durableVersionByProject.current.get(project.id);
    if (savedVersion === undefined) {
      durableVersionByProject.current.set(project.id, snapshot.version);
      return;
    }
    if (savedVersion === snapshot.version) return;
    const timer = window.setTimeout(() => {
      const durableProject = projectSnapshotDocument(project);
      snapshotSaveSequence.current = snapshotSaveSequence.current
        .catch(() => undefined)
        .then(async () => {
          let expectedHead = project.nativeHeadRevisionId!;
          try {
            const saved = await projectSnapshotSave({
              projectId: project.nativeProjectId!,
              projectDirectory: project.nativeProjectDirectory!,
              expectedHeadRevisionId: expectedHead,
              snapshot: durableProject,
              message: "Saved scene and script edits",
            });
            durableVersionByProject.current.set(project.id, snapshot.version);
            setSnapshot((current) => ({
              ...current,
              projects: current.projects.map((item) => item.id === project.id ? {
                ...item,
                nativeHeadRevisionId: saved.headRevisionId,
                nativeRevisionNumber: saved.revisionNumber,
              } : item),
            }));
          } catch (error) {
            if (!errorMessage(error).includes("REVISION_CONFLICT")) throw error;
            const current = await projectSnapshotGet({
              projectId: project.nativeProjectId!,
              projectDirectory: project.nativeProjectDirectory!,
            });
            expectedHead = current.headRevisionId;
            const saved = await projectSnapshotSave({
              projectId: project.nativeProjectId!,
              projectDirectory: project.nativeProjectDirectory!,
              expectedHeadRevisionId: expectedHead,
              snapshot: durableProject,
              message: "Saved scene and script edits after refresh",
            });
            durableVersionByProject.current.set(project.id, snapshot.version);
            setSnapshot((state) => ({
              ...state,
              projects: state.projects.map((item) => item.id === project.id ? {
                ...item,
                nativeHeadRevisionId: saved.headRevisionId,
                nativeRevisionNumber: saved.revisionNumber,
              } : item),
            }));
          }
        })
        .catch((error: unknown) => notify("Project edits need attention", errorMessage(error), "warning"));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [activeProjectId, snapshot.projects, snapshot.version, setSnapshot]);

  const createTutorial = async (project: ProjectRecord, settings: TutorialCreationSettings) => {
    const bootstrap = runtime.bootstrap ?? await appBootstrap();
    const initialSnapshot = projectSnapshotDocument({
      ...project,
      locale: project.locale,
    }, {
      brief: {
        topic: project.topic,
        audience: project.audience,
        durationSeconds: project.duration * 60,
        locale: localeCode(project.locale),
      },
      groundingMode: settings.grounding,
    });
    const handle = await projectCreate({
      parentDirectory: bootstrap.paths.projects,
      directoryName: projectDirectoryName(project.title),
      title: project.title,
      locale: localeCode(project.locale),
      groundingMode: settings.grounding,
      initialSnapshot,
    });
    const initialized = await projectSnapshotGet({
      projectId: handle.manifest.projectId,
      projectDirectory: handle.projectDirectory,
    });
    let createdProject: ProjectRecord = {
      ...project,
      id: handle.manifest.projectId,
      nativeProjectId: handle.manifest.projectId,
      nativeProjectDirectory: handle.projectDirectory,
      nativeHeadRevisionId: initialized.headRevisionId,
      nativeRevisionNumber: initialized.revisionNumber,
    };
    for (const file of settings.sourceFiles) {
      const receipt = await importSelectedFile(createdProject, file);
      createdProject = appendImportedSource(createdProject, receipt);
    }
    const receipt = await generationStart({
      projectId: handle.manifest.projectId,
      projectDirectory: handle.projectDirectory,
      snapshotId: createdProject.nativeHeadRevisionId ?? null,
      scope: { kind: "project" },
      quality: settings.quality,
      privacy: "local",
      budget: { currency: "USD", hardLimitMinorUnits: 34, requireKnownPricing: true },
      approvedProviderIds: [],
      preservationLocks: [],
    });
    setNativeJobs((current) => ({
      ...current,
      [receipt.jobId]: { projectId: handle.manifest.projectId, projectDirectory: handle.projectDirectory, jobId: receipt.jobId },
    }));
    setSnapshot((current) => ({
      ...current,
      projects: [createdProject, ...current.projects],
      recentProjectId: createdProject.id,
      jobs: [receiptJob(receipt, "Creating learning plan", createdProject.title, { projectId: handle.manifest.projectId, projectDirectory: handle.projectDirectory }), ...current.jobs],
    }));
    setNewTutorialOpen(false);
    setActiveProjectId(createdProject.id);
    setActiveSceneId(createdProject.scenes[0]?.id ?? "");
    setWorkspace("plan");
    setJobsOpen(true);
    notify("Local project created", `${createdProject.title} is stored under ${bootstrap.paths.projects}.`, receipt.state === "BLOCKED" || receipt.state === "FAILED" ? "warning" : "success");
  };

  const importSources = async (projectId: string, files: File[]) => {
    if (files.length === 0) return [];
    let project = snapshot.projects.find((item) => item.id === projectId);
    if (!project?.nativeProjectId || !project.nativeProjectDirectory) {
      throw new Error("Open or create a local project before importing source files.");
    }
    if (!project.nativeHeadRevisionId) {
      const loaded = await projectSnapshotGet({
        projectId: project.nativeProjectId,
        projectDirectory: project.nativeProjectDirectory,
      });
      project = { ...project, nativeHeadRevisionId: loaded.headRevisionId, nativeRevisionNumber: loaded.revisionNumber };
    }
    const receipts: SourceImportReceipt[] = [];
    for (const file of files) {
      const receipt = await importSelectedFile(project, file);
      receipts.push(receipt);
      project = appendImportedSource(project, receipt);
      const nextProject = project;
      setSnapshot((current) => ({
        ...current,
        projects: current.projects.map((item) => item.id === projectId ? nextProject : item),
      }));
    }
    return receipts;
  };

  const exportArchive = async (projectId: string) => {
    const project = snapshot.projects.find((item) => item.id === projectId);
    if (!project?.nativeProjectId || !project.nativeProjectDirectory) {
      throw new Error("This project is not linked to a local Alystria folder.");
    }
    const receipt = await projectExportArchive({
      projectId: project.nativeProjectId,
      projectDirectory: project.nativeProjectDirectory,
    });
    setSnapshot((current) => ({
      ...current,
      projects: current.projects.map((item) => item.id === projectId ? { ...item, nativeArchivePath: receipt.path } : item),
    }));
    return receipt.path;
  };

  const cancelJob = async (id: string) => {
    const nativeJob = nativeJobs[id];
    if (!nativeJob) {
      setSnapshot((current) => ({ ...current, jobs: current.jobs.filter((job) => job.id !== id) }));
      notify("Demo job cancelled", "No accepted artifact was changed.", "warning");
      return;
    }
    try {
      const receipt = await jobCancel(nativeJob);
      setSnapshot((current) => ({ ...current, jobs: current.jobs.map((job) => job.id === id ? receiptJob(receipt, job.title, job.detail, nativeJobProject(job) ?? undefined) : job) }));
      notify("Job cancellation requested", receipt.message, "warning");
    } catch (error) {
      notify("Could not cancel job", errorMessage(error), "warning");
    }
  };

  const retryNativeJob = async (id: string) => {
    const nativeJob = nativeJobs[id];
    if (!nativeJob) return;
    try {
      const receipt = await jobRetry(nativeJob);
      setSnapshot((current) => ({ ...current, jobs: current.jobs.map((job) => job.id === id ? receiptJob(receipt, job.title, job.detail, nativeJobProject(job) ?? undefined) : job) }));
      notify("Job retry requested", receipt.message, "info");
    } catch (error) {
      notify("Could not retry job", errorMessage(error), "warning");
    }
  };

  const approveProjectGeneration = async (projectId: string) => {
    const entry = Object.entries(nativeJobs).find(([, link]) => link.projectId === projectId);
    if (!entry) {
      notify("Learning plan approved", "Browser demo approval is reflected in the storyboard.", "success");
      setWorkspace("storyboard");
      return;
    }
    const [jobId, link] = entry;
    try {
      const receipt = await generationApprove(link);
      setSnapshot((current) => ({
        ...current,
        jobs: current.jobs.map((job) => job.id === jobId ? receiptJob(receipt, job.title, job.detail) : job),
      }));
      setWorkspace(receipt.state === "SUCCEEDED" ? "review" : "storyboard");
      setJobsOpen(receipt.state !== "SUCCEEDED");
      notify(
        receipt.state === "SUCCEEDED" ? "Tutorial generation completed" : "Storyboard approved",
        receipt.message,
        receipt.state === "FAILED" || receipt.state === "BLOCKED" ? "warning" : "success",
      );
    } catch (error) {
      notify("Could not approve generation", errorMessage(error), "warning");
    }
  };

  const baseGenerationJobId = (projectId: string) => snapshot.jobs.find((job) =>
    job.projectId === projectId && !job.operation && nativeJobs[job.id],
  )?.id;

  const addNativeControlJob = (project: ProjectRecord, receipt: JobReceipt, title: string, detail: string) => {
    const link = nativeProjectLink(project);
    if (!link) return;
    setNativeJobs((current) => ({
      ...current,
      [receipt.jobId]: { ...link, jobId: receipt.jobId },
    }));
    addJob(receiptJob(receipt, title, detail, link));
    setJobsOpen(true);
  };

  const refreshProjectAfterControl = async (project: ProjectRecord, receipt: JobReceipt) => {
    const nextHead = receipt.result?.headRevisionId;
    if (!project.nativeProjectId || !project.nativeProjectDirectory || typeof nextHead !== "string") return;
    const nativeProjectId = project.nativeProjectId;
    const nativeProjectDirectory = project.nativeProjectDirectory;
    const durable = await projectSnapshotGet({
      projectId: nativeProjectId,
      projectDirectory: nativeProjectDirectory,
    });
    setSnapshot((current) => ({
      ...current,
      projects: current.projects.map((item) => item.id === project.id
        ? hydrateDurableProject(item, durable.snapshot, {
          nativeProjectId,
          nativeProjectDirectory,
          nativeHeadRevisionId: durable.headRevisionId,
          nativeRevisionNumber: durable.revisionNumber,
        })
        : item),
    }));
  };

  const navigateHistory = async (direction: "undo" | "redo") => {
    const project = snapshot.projects.find((item) => item.id === activeProjectId);
    if (!project?.nativeProjectId || !project.nativeProjectDirectory || !project.nativeHeadRevisionId) {
      notify(
        runtime.environment === "browser-demo" ? "Browser demo history" : "History unavailable",
        runtime.environment === "browser-demo" ? "Open a browser-created demo project to simulate revision restore." : "Open or create a native project before using durable history.",
        "info",
      );
      return;
    }
    const nativeProjectId = project.nativeProjectId;
    const nativeProjectDirectory = project.nativeProjectDirectory;
    try {
      await snapshotSaveSequence.current;
      const action = {
        projectId: nativeProjectId,
        projectDirectory: nativeProjectDirectory,
        expectedHeadRevisionId: project.nativeHeadRevisionId,
      };
      const restored = direction === "undo" ? await projectHistoryUndo(action) : await projectHistoryRedo(action);
      setSnapshot((current) => ({
        ...current,
        projects: current.projects.map((item) => item.id === project.id
          ? hydrateDurableProject(item, restored.snapshot, {
            nativeProjectId,
            nativeProjectDirectory,
            nativeHeadRevisionId: restored.headRevisionId,
            nativeRevisionNumber: restored.revisionNumber,
          })
          : item),
      }));
      notify(
        direction === "undo" ? "Revision restored" : "Revision reapplied",
        `${runtime.environment === "browser-demo" ? "Browser demo only · " : ""}Created revision ${restored.revisionNumber}; no history was deleted.`,
        "success",
      );
    } catch (error) {
      notify(`Could not ${direction}`, errorMessage(error), "warning");
    }
  };

  const renderNativeScene = async (scene: Scene) => {
    const project = snapshot.projects.find((item) => item.id === activeProjectId)!;
    const link = nativeProjectLink(project);
    if (!link || !project.nativeHeadRevisionId) {
      if (runtime.environment === "browser-demo") {
        const demo: JobReceipt = { jobId: `demo-${Date.now()}`, state: "SUCCEEDED", acceptedAt: new Date().toISOString(), message: "Browser demo only: scene render simulated; no media file was created.", retryable: false, operation: "render_scene", result: { demoOnly: true } };
        addJob(receiptJob(demo, `Scene ${scene.index} preview`, scene.title));
        setJobsOpen(true);
        notify("Browser demo only", demo.message, "info");
      } else notify("Scene render unavailable", "Open or create a native project first.", "warning");
      return;
    }
    try {
      await snapshotSaveSequence.current;
      const baseJobId = baseGenerationJobId(project.id);
      const receipt = await sceneRender({
        ...link,
        baseRevisionId: project.nativeHeadRevisionId,
        ...(baseJobId ? { baseJobId } : {}),
        sceneId: scene.id,
        aspect: "16:9",
        resolution: "1080p",
        fps: 30,
      });
      addNativeControlJob(project, receipt, `Scene ${scene.index} preview`, scene.title);
      notify(receipt.state === "SUCCEEDED" ? "Scene rendered" : "Scene render unavailable", receipt.message, receipt.state === "SUCCEEDED" ? "success" : "warning");
    } catch (error) {
      notify("Scene render unavailable", errorMessage(error), "warning");
    }
  };

  const repairSelectedQa = async () => {
    const project = snapshot.projects.find((item) => item.id === activeProjectId)!;
    const link = nativeProjectLink(project);
    const baseJobId = baseGenerationJobId(project.id);
    const findingIds = project.nativeRepairableFindingIds ?? [];
    if (!link || !project.nativeHeadRevisionId || !baseJobId || findingIds.length === 0) {
      notify(runtime.environment === "browser-demo" ? "Browser demo only" : "QA repair unavailable", runtime.environment === "browser-demo" ? "The repair gesture is simulated in browser preview; no candidate is persisted." : "A completed durable generation with selected repairable findings is required.", "info");
      return;
    }
    try {
      const receipt = await qaRepair({ ...link, baseRevisionId: project.nativeHeadRevisionId, baseJobId, findingIds });
      addNativeControlJob(project, receipt, "Selected QA repair", "Bounded to two attempts");
      await refreshProjectAfterControl(project, receipt);
      notify(receipt.state === "SUCCEEDED" ? "Repair candidate persisted" : "QA repair blocked", receipt.message, receipt.state === "SUCCEEDED" ? "success" : "warning");
    } catch (error) {
      notify("QA repair blocked", errorMessage(error), "warning");
    }
  };

  const exportNativeMaster = async (settings: Pick<MasterExportRequest, "aspect" | "resolution" | "fps" | "captions" | "transcript" | "bibliography">) => {
    const project = snapshot.projects.find((item) => item.id === activeProjectId)!;
    const link = nativeProjectLink(project);
    const baseJobId = baseGenerationJobId(project.id);
    if (!link || !project.nativeHeadRevisionId || !baseJobId) {
      if (runtime.environment === "browser-demo") {
        const demo: JobReceipt = { jobId: `demo-${Date.now()}`, state: "SUCCEEDED", acceptedAt: new Date().toISOString(), message: "Browser demo only: master export simulated; no media file was created.", retryable: false, operation: "export_master", result: { demoOnly: true } };
        addJob(receiptJob(demo, `${project.title} · ${settings.resolution}`, `${settings.aspect} demo-only master`));
        setJobsOpen(true);
        notify("Browser demo only", demo.message, "info");
        return demo;
      }
      throw new Error("A completed durable generation and current project revision are required for master export.");
    }
    const receipt = await masterExport({ ...link, baseRevisionId: project.nativeHeadRevisionId, baseJobId, ...settings });
    addNativeControlJob(project, receipt, `${project.title} · ${settings.resolution}`, `${settings.aspect} master`);
    return receipt;
  };

  return (
    <div className={`app-shell ${mobileNavOpen ? "nav-open" : ""}`}>
      <a href="#main-content" className="skip-link">Skip to workspace</a>
      <Sidebar
        area={area}
        workspace={workspace}
        project={activeProject}
        mobileNavOpen={mobileNavOpen}
        onGlobal={navigateGlobal}
        onWorkspace={(next) => { setWorkspace(next); setMobileNavOpen(false); }}
        onNew={() => { setNewTutorialOpen(true); setMobileNavOpen(false); }}
      />

      <div className="app-stage">
        <Topbar
          project={workspace ? activeProject : null}
          workspace={workspace}
          mode={snapshot.studioMode}
          jobs={snapshot.jobs}
          runtime={runtime}
          onMode={setMode}
          onJobs={() => setJobsOpen((open) => !open)}
          onMenu={() => setMobileNavOpen((open) => !open)}
          onCommand={() => setCommandOpen(true)}
          onBack={() => navigateGlobal("projects")}
        />
        <main id="main-content" className={workspace === "studio" ? "main-content studio-main" : "main-content"}>
          {workspace ? (
            <ProjectWorkspace
              workspace={workspace}
              project={activeProject}
              activeScene={activeScene}
              mode={snapshot.studioMode}
              version={snapshot.version}
              onWorkspace={setWorkspace}
              onScene={(scene) => { setActiveSceneId(scene.id); if (workspace !== "studio") setWorkspace("studio"); }}
              onSelectScene={setActiveSceneId}
              onSceneUpdate={(sceneId, update) => updateScene(activeProject.id, sceneId, update)}
              onRegenerate={setRegenScene}
              onNotify={notify}
              onAddJob={addJob}
              onImportSources={(files) => importSources(activeProject.id, files)}
              onExportArchive={() => exportArchive(activeProject.id)}
              onApproveGeneration={() => { void approveProjectGeneration(activeProject.id); }}
              onUndo={() => { void navigateHistory("undo"); }}
              onRedo={() => { void navigateHistory("redo"); }}
              onRenderScene={(scene) => { void renderNativeScene(scene); }}
              onRepairQa={() => { void repairSelectedQa(); }}
              onExportMaster={exportNativeMaster}
            />
          ) : (
            <GlobalWorkspace
              area={area}
              snapshot={snapshot}
              runtime={runtime}
              onArea={navigateGlobal}
              onOpenProject={openProject}
              onNew={() => setNewTutorialOpen(true)}
              onNotify={notify}
              onImportSources={(files) => importSources(snapshot.recentProjectId, files)}
              onReset={() => { resetSnapshot(); notify("Demo data restored", "Local projects and preferences returned to the starter state.", "info"); }}
            />
          )}
        </main>
      </div>

      <JobsDrawer open={jobsOpen} jobs={snapshot.jobs} nativeJobIds={new Set(Object.keys(nativeJobs))} onClose={() => setJobsOpen(false)} onCancel={(id) => { void cancelJob(id); }} onRetry={(id) => { void retryNativeJob(id); }} />

      {newTutorialOpen && <NewTutorialWizard environment={runtime.environment} onClose={() => setNewTutorialOpen(false)} onCreate={createTutorial} />}

      {regenScene && <RegenerationSheet scene={regenScene} onClose={() => setRegenScene(null)} onRun={(instruction, preserve, alternatives) => {
        const scene = regenScene;
        const projectLink = nativeProjectLink(activeProject);
        const start = async () => {
          if (projectLink && activeProject.nativeHeadRevisionId) {
            await snapshotSaveSequence.current;
            const baseJobId = baseGenerationJobId(activeProject.id);
            const receipt = await sceneRegenerate({
              ...projectLink,
              baseRevisionId: activeProject.nativeHeadRevisionId,
              ...(baseJobId ? { baseJobId } : {}),
              sceneId: scene.id,
              instruction,
              preservationLocks: preserve ? ["narration", "citations", "learningobjective"] : ["learningobjective"],
              alternatives,
            });
            addNativeControlJob(activeProject, receipt, `Regenerating scene ${scene.index}`, instruction || `Refine ${scene.title}`);
            await refreshProjectAfterControl(activeProject, receipt);
            notify(receipt.state === "SUCCEEDED" ? "Candidate work persisted" : "Candidate work blocked", receipt.message, receipt.state === "SUCCEEDED" ? "success" : "warning");
          } else {
            addJob({ id: `demo-${Date.now()}`, title: `Regenerating scene ${scene.index}`, detail: "Browser demo only · candidate simulation; accepted scene unchanged", status: "complete", progress: 100, operation: "regenerate_scene", result: { demoOnly: true } });
            setJobsOpen(true);
            notify("Browser demo only", "Candidate simulation completed; no native revision or artifact was created.", "info");
          }
        };
        void start().catch((error: unknown) => notify("Candidate could not start", errorMessage(error), "warning"));
        setRegenScene(null);
      }} />}

      {commandOpen && <CommandPalette projects={snapshot.projects} onClose={() => setCommandOpen(false)} onNavigate={(next) => { navigateGlobal(next); setCommandOpen(false); }} onOpen={(id) => { openProject(id); setCommandOpen(false); }} />}

      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => <Toast key={toast.id} toast={toast} onClose={() => setToasts((items) => items.filter((item) => item.id !== toast.id))} />)}
      </div>
    </div>
  );
}

function Sidebar({ area, workspace, project, mobileNavOpen, onGlobal, onWorkspace, onNew }: {
  area: GlobalArea;
  workspace: Workspace | null;
  project: ProjectRecord;
  mobileNavOpen: boolean;
  onGlobal: (area: GlobalArea) => void;
  onWorkspace: (workspace: Workspace) => void;
  onNew: () => void;
}) {
  return (
    <aside className={`sidebar ${mobileNavOpen ? "mobile-open" : ""}`} aria-label="Primary navigation">
      <div className="brand-lockup"><LogoMark /><span><strong>Alystria</strong><small>Studio 2.0</small></span></div>
      <button className="new-project-button" onClick={onNew}><Plus size={17} /> <span>New tutorial</span></button>
      {workspace ? (
        <>
          <button className="project-switcher" onClick={() => onGlobal("projects")}>
            <span className="project-glyph"><Braces size={16} /></span>
            <span><small>Current project</small><strong>{project.title}</strong></span>
            <ChevronDown size={15} />
          </button>
          <nav className="nav-list project-nav" aria-label="Project workspace">
            <p className="nav-caption">Build</p>
            {projectNav.map(({ id, label, icon: Icon }, index) => (
              <button key={id} aria-label={label} className={workspace === id ? "active" : ""} onClick={() => onWorkspace(id)} aria-current={workspace === id ? "page" : undefined}>
                <span className="nav-index">{index + 1}</span><Icon size={17} /><span>{label}</span>
                {id === "review" && <span className="nav-badge amber">3</span>}
              </button>
            ))}
          </nav>
          <div className="sidebar-thread" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <button className="all-projects-link" onClick={() => onGlobal("projects")}><ArrowLeft size={15} /> <span>All projects</span></button>
        </>
      ) : (
        <nav className="nav-list" aria-label="Alystria areas">
          {globalNav.map(({ id, label, icon: Icon }) => (
            <button key={id} aria-label={label} className={area === id ? "active" : ""} onClick={() => onGlobal(id)} aria-current={area === id ? "page" : undefined}>
              <Icon size={18} /><span>{label}</span>
              {id === "providers" && <span className="status-dot online" aria-label="Providers ready" />}
            </button>
          ))}
        </nav>
      )}
      <div className="sidebar-bottom">
        <div className="local-status"><span><HardDrive size={14} /> Local workspace</span><small>Protected · 184 GB free</small></div>
        <button className="profile-button" aria-label="Open profile settings"><span>AI</span><span className="profile-copy"><strong>Akshit</strong><small>Local studio</small></span><MoreHorizontal size={16} /></button>
      </div>
    </aside>
  );
}

function Topbar({ project, workspace, mode, jobs, runtime, onMode, onJobs, onMenu, onCommand, onBack }: {
  project: ProjectRecord | null;
  workspace: Workspace | null;
  mode: StudioMode;
  jobs: JobRecord[];
  runtime: RuntimeState;
  onMode: (mode: StudioMode) => void;
  onJobs: () => void;
  onMenu: () => void;
  onCommand: () => void;
  onBack: () => void;
}) {
  const running = jobs.filter((job) => job.status === "running" || job.status === "queued").length;
  return (
    <header className="topbar">
      <button className="icon-button mobile-menu" onClick={onMenu} aria-label="Toggle navigation"><Menu size={19} /></button>
      <div className="breadcrumbs">
        {project ? <><button onClick={onBack}>Projects</button><ChevronRight size={14} /><strong>{project.title}</strong><span className="crumb-workspace">/ {workspace}</span></> : <><span className="eyebrow-dot" /><strong>Private local workspace</strong></>}
      </div>
      <div className="topbar-actions">
        <RuntimeBadge runtime={runtime} />
        {project && <div className="mode-switch" role="group" aria-label="Interface mode">
          <button className={mode === "guided" ? "active" : ""} onClick={() => onMode("guided")}>Guided</button>
          <button className={mode === "studio" ? "active" : ""} onClick={() => onMode("studio")}>Studio</button>
        </div>}
        <button className="command-trigger" onClick={onCommand}><Search size={15} /><span>Search or run</span><kbd>⌘ K</kbd></button>
        <button className={`jobs-button ${running ? "is-running" : ""}`} onClick={onJobs}><Activity size={17} /><span>Jobs</span>{running > 0 && <b>{running}</b>}</button>
      </div>
    </header>
  );
}

function GlobalWorkspace({ area, snapshot, runtime, onArea, onOpenProject, onNew, onNotify, onImportSources, onReset }: {
  area: GlobalArea;
  snapshot: AppSnapshot;
  runtime: RuntimeState;
  onArea: (area: GlobalArea) => void;
  onOpenProject: (projectId: string, workspace?: Workspace) => void;
  onNew: () => void;
  onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void;
  onImportSources: (files: File[]) => Promise<SourceImportReceipt[]>;
  onReset: () => void;
}) {
  switch (area) {
    case "home": return <HomeView snapshot={snapshot} runtime={runtime} onOpen={onOpenProject} onNew={onNew} onArea={onArea} />;
    case "projects": return <ProjectsView projects={snapshot.projects} onOpen={onOpenProject} onNew={onNew} />;
    case "templates": return <TemplatesView onUse={onNew} />;
    case "library": return <LibraryView project={snapshot.projects.find((project) => project.id === snapshot.recentProjectId) ?? snapshot.projects[0]!} onNotify={onNotify} onImportSources={onImportSources} />;
    case "providers": return <ProvidersView environment={runtime.environment} onNotify={onNotify} />;
    case "diagnostics": return <DiagnosticsView runtime={runtime} onNotify={onNotify} onReset={onReset} />;
  }
}

function HomeView({ snapshot, runtime, onOpen, onNew, onArea }: {
  snapshot: AppSnapshot;
  runtime: RuntimeState;
  onOpen: (id: string, workspace?: Workspace) => void;
  onNew: () => void;
  onArea: (area: GlobalArea) => void;
}) {
  const featured = snapshot.projects.find((project) => project.id === snapshot.recentProjectId) ?? snapshot.projects[0]!;
  return (
    <div className="page home-page">
      <section className="home-hero">
        <div className="hero-copy">
          <span className="section-kicker"><Sparkles size={14} /> Your teaching studio</span>
          <h1>Turn a difficult idea into<br /><em>a clear line of thought.</em></h1>
          <p>Research, structure, narrate, and render rigorous tutorials—without losing the thread between a claim and the scene that teaches it.</p>
          <div className="hero-actions"><button className="primary-button" onClick={onNew}><Plus size={17} /> Create a tutorial</button><button className="secondary-button" onClick={() => onOpen(featured.id)}><PlayCircle size={17} /> Continue working</button></div>
        </div>
        <div className="concept-thread-hero" aria-label="A tutorial moves from idea to evidence to scene to review">
          <div className="thread-line" />
          <div className="thread-node node-idea"><span><TextCursorInput size={17} /></span><small>Idea</small><strong>Karatsuba multiplication</strong></div>
          <div className="thread-node node-evidence"><span><Link2 size={17} /></span><small>Evidence</small><strong>42 grounded excerpts</strong></div>
          <div className="thread-node node-scene"><span><Film size={17} /></span><small>Scene</small><strong>8 visual moments</strong></div>
          <div className="thread-node node-review"><span><BadgeCheck size={17} /></span><small>Review</small><strong>3 checks remain</strong></div>
          <div className="thread-watermark">THREAD / 08</div>
        </div>
      </section>

      <section className="continue-section">
        <div className="section-heading"><div><span className="section-kicker">Continue the thread</span><h2>{featured.title}</h2></div><button className="text-button" onClick={() => onOpen(featured.id)}>Open project <ArrowRight size={15} /></button></div>
        <button className="continue-card" onClick={() => onOpen(featured.id, "storyboard")}>
          <div className="continue-preview"><SceneArtwork scene={featured.scenes[3]!} compact /><div className="preview-time">03:14 / 12:00</div></div>
          <div className="continue-details">
            <div className="project-status-line"><StatusPill status={featured.status} /><span>{featured.updatedAt}</span></div>
            <h3>Review the three-product insight</h3>
            <p>The worked derivation is ready. One citation and two narration beats still need attention before production.</p>
            <div className="continue-metrics"><span><Layers3 size={15} /> 8 scenes</span><span><Link2 size={15} /> 42 evidence spans</span><span><Languages size={15} /> English</span></div>
            <ProgressBar value={featured.progress} /><small>{featured.progress}% ready for export</small>
          </div>
        </button>
      </section>

      <section className="home-grid">
        <div className="home-panel recent-panel">
          <div className="panel-heading"><div><span className="section-kicker">Recent projects</span><h3>On your workbench</h3></div><button className="icon-button" onClick={() => onArea("projects")} aria-label="View all projects"><ArrowRight size={17} /></button></div>
          <div className="mini-project-list">{snapshot.projects.slice(1, 3).map((project) => <button key={project.id} onClick={() => onOpen(project.id)}><span className={`mini-project-art art-${project.id}`}><Film size={19} /></span><span><strong>{project.title}</strong><small>{project.locale} · {project.duration} min · {project.updatedAt}</small></span><span className="mini-progress">{project.progress}%</span></button>)}</div>
        </div>
        <div className="home-panel readiness-panel">
          <div className="panel-heading"><div><span className="section-kicker">Studio readiness</span><h3>Everything stays in view</h3></div><ShieldCheck className="teal" size={23} /></div>
          <div className="readiness-list">
            <span><CheckCircle2 /> {runtime.environment === "native" ? "Native project storage" : "Browser demo storage"} <b>{runtime.bootstrap ? "Ready" : "Checking"}</b></span>
            <span>{runtime.bootstrap?.worker.state === "ready" ? <CheckCircle2 /> : <CircleAlert />} Pipeline worker <b className={runtime.bootstrap?.worker.state === "ready" ? "" : "amber-text"}>{workerLabel(runtime.bootstrap?.worker)}</b></span>
            <span><CircleAlert /> Voice provider <b className="amber-text">Optional</b></span>
          </div>
          <button className="text-button" onClick={() => onArea("diagnostics")}>Open diagnostics <ArrowRight size={15} /></button>
        </div>
      </section>
    </div>
  );
}

function ProjectsView({ projects, onOpen, onNew }: { projects: ProjectRecord[]; onOpen: (id: string) => void; onNew: () => void }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const filtered = projects.filter((project) => (filter === "All" || project.status === filter) && `${project.title} ${project.topic}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="page projects-page">
      <PageTitle kicker="Local workbench" title="Projects" description="Each tutorial is a private folder with its own sources, history, artifacts, and exports." action={<button className="primary-button" onClick={onNew}><Plus size={17} /> New tutorial</button>} />
      <div className="toolbar"><label className="search-field"><Search size={16} /><input aria-label="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" /></label><div className="filter-pills">{["All", "Planning", "Ready to review", "Complete"].map((item) => <button key={item} onClick={() => setFilter(item)} className={filter === item ? "active" : ""}>{item}</button>)}</div><button className="icon-button"><SlidersHorizontal size={17} /></button></div>
      {filtered.length ? <div className="project-grid">{filtered.map((project) => <ProjectCard key={project.id} project={project} onOpen={() => onOpen(project.id)} />)}<button className="project-card new-card" onClick={onNew}><span><Plus size={24} /></span><strong>Start with a difficult idea</strong><small>Build a grounded learning plan first.</small></button></div> : <EmptyState icon={Search} title="No projects match" detail="Try a different phrase or clear the current status filter." action={<button className="secondary-button" onClick={() => { setQuery(""); setFilter("All"); }}>Clear filters</button>} />}
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: ProjectRecord; onOpen: () => void }) {
  return <button className="project-card" onClick={onOpen}>
    <div className={`project-card-art art-${project.id}`}><span className="project-card-label">{project.theme}</span><SceneArtwork scene={project.scenes[0]!} compact /></div>
    <div className="project-card-body"><div className="project-card-meta"><StatusPill status={project.status} /><span>{project.updatedAt}</span></div><h3>{project.title}</h3><p>{project.description}</p><div className="project-card-footer"><span>{project.scenes.length} scenes · {project.duration} min</span><span>{project.progress}%</span></div><ProgressBar value={project.progress} /></div>
  </button>;
}

function TemplatesView({ onUse }: { onUse: () => void }) {
  const [category, setCategory] = useState("All");
  const shown = category === "All" ? templates : templates.filter((template) => template.category === category);
  return <div className="page">
    <PageTitle kicker="Starting structures" title="Templates" description="Editorially designed learning arcs—not prompt presets. Every structure adapts to your audience and evidence." />
    <div className="template-banner"><div><span className="section-kicker"><Star size={14} /> Featured learning arc</span><h2>Build intuition, then earn the formula.</h2><p>A purpose-built sequence for technical concepts: misconception, visual model, derivation, worked example, and transfer check.</p><button className="light-button" onClick={onUse}>Use this structure <ArrowRight size={15} /></button></div><ConceptDiagram /></div>
    <div className="toolbar template-toolbar"><div className="filter-pills">{["All", "Concept", "Code", "Humanities", "Mathematics", "Software", "Illustrated"].map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div></div>
    <div className="template-grid">{shown.map((template, index) => <article className={`template-card template-${template.color}`} key={template.name}><div className="template-visual"><span>{template.category}</span><div className="mini-thread">{Array.from({ length: 5 }, (_, dot) => <i key={dot} style={{ left: `${12 + dot * 19}%`, top: `${54 + Math.sin(dot + index) * 20}%` }} />)}</div></div><div><small>{template.scenes} suggested scenes</small><h3>{template.name}</h3><p>{template.description}</p><button className="text-button" onClick={onUse}>Use template <ArrowRight size={15} /></button></div></article>)}</div>
  </div>;
}

function LibraryView({ project, onNotify, onImportSources }: { project: ProjectRecord; onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void; onImportSources: (files: File[]) => Promise<SourceImportReceipt[]> }) {
  const [tab, setTab] = useState("Sources");
  return <div className="page">
    <PageTitle kicker="Reusable material" title="Library" description="Sources, visuals, audio, and brand kits stay local and carry their rights information with them." action={<SourceImportControl label="Import assets" onImport={onImportSources} onNotify={onNotify} />} />
    <div className="subtabs">{["Sources", "Visuals", "Audio", "Brand kits"].map((item) => <button className={tab === item ? "active" : ""} onClick={() => setTab(item)} key={item}>{item}</button>)}</div>
    {tab === "Sources" ? <div className="library-layout"><div className="library-list"><div className="library-list-head"><strong>{project.sources.length} source records</strong><span>{project.sources.filter((source) => source.status === "verified").length} verified · {project.sources.filter((source) => source.privacy !== "public").length} private</span></div>{project.sources.map((source) => <button key={source.id}><span className={`source-icon ${source.kind}`}><FileText size={18} /></span><span><strong>{source.title}</strong><small>{source.origin}{source.byteSize ? ` · ${formatBytes(source.byteSize)}` : ""}</small></span><span className="license-tag">{source.license}</span><ChevronRight size={16} /></button>)}</div><aside className="library-summary"><span className="section-kicker">Rights at a glance</span><h3>Every reusable asset has a paper trail.</h3><div className="donut-wrap"><div className="donut"><span>{project.sources.length ? Math.round(project.sources.filter((source) => source.status === "verified").length / project.sources.length * 100) : 0}%<small>cleared</small></span></div></div><ul><li><i className="teal-bg" /> Cleared for export <b>{project.sources.filter((source) => source.status === "verified").length}</b></li><li><i className="amber-bg" /> Needs review <b>{project.sources.filter((source) => source.status === "review").length}</b></li><li><i className="ink-bg" /> Local/private <b>{project.sources.filter((source) => source.privacy !== "public").length}</b></li></ul></aside></div> : <EmptyState icon={tab === "Visuals" ? Image : tab === "Audio" ? AudioLines : Presentation} title={`${tab} library is ready`} detail={`Import ${tab.toLowerCase()} with provenance, or create them inside a project.`} action={<SourceImportControl label={`Import ${tab.toLowerCase()}`} onImport={onImportSources} onNotify={onNotify} secondary />} />}
  </div>;
}

function ProvidersView({ environment, onNotify }: { environment: RuntimeState["environment"]; onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void }) {
  const [mode, setMode] = useState("Hybrid");
  const [secretRefs, setSecretRefs] = useState<Record<string, ProviderSecretRef>>({});
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const providers = providerConfigs;

  useEffect(() => {
    let active = true;
    void Promise.all(providerConfigs.filter((provider) => !provider.local).map(async (provider) => [provider.id, await providerSecretStatus({ providerId: provider.id, credentialKind: "api_key" })] as const))
      .then((entries) => { if (active) setSecretRefs(Object.fromEntries(entries)); })
      .catch(() => {
        if (active) setSecretRefs(Object.fromEntries(providerConfigs.filter((provider) => !provider.local).map((provider) => [provider.id, { reference: "", providerId: provider.id, credentialKind: "api_key", availability: "keyringUnavailable", updatedAt: null } satisfies ProviderSecretRef])));
      });
    return () => { active = false; };
  }, [environment]);

  const saveSecret = async () => {
    if (!editingProvider || !secret.trim()) return;
    setSaving(true);
    try {
      const reference = await providerSecretSet({ providerId: editingProvider, credentialKind: "api_key", secret });
      setSecretRefs((current) => ({ ...current, [editingProvider]: reference }));
      setSecret("");
      setEditingProvider(null);
      onNotify(environment === "native" ? "Credential stored in OS vault" : "Browser demo connection updated", environment === "native" ? "Only an opaque reference is visible to Alystria projects." : "The preview discarded the credential value and retained only session availability.", "success");
    } catch (error) {
      onNotify("Credential was not stored", errorMessage(error), "warning");
    } finally {
      setSaving(false);
    }
  };

  const deleteSecret = async (providerId: string) => {
    try {
      const reference = await providerSecretDelete({ providerId, credentialKind: "api_key" });
      setSecretRefs((current) => ({ ...current, [providerId]: reference }));
      onNotify("Credential removed", environment === "native" ? "The OS vault entry was deleted." : "The browser demo availability flag was cleared.", "info");
    } catch (error) {
      onNotify("Credential could not be removed", errorMessage(error), "warning");
    }
  };
  return <div className="page">
    <PageTitle kicker="Your compute, your choice" title="Models & providers" description="Alystria only routes work to providers you configure and approve. Local mode blocks project-content networking." />
    <section className="routing-card"><div><span className="section-kicker">Default routing boundary</span><h3>{mode} creation</h3><p>{mode === "Local" ? "All generation remains on this device. No cloud fallback." : mode === "Cloud" ? "Use only connected cloud providers after cost and privacy approval." : "Keep private sources local; route approved creative tasks to cloud providers."}</p></div><div className="segmented-large" role="group" aria-label="Provider routing mode">{["Local", "Hybrid", "Cloud"].map((item) => <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}><span>{item === "Local" ? <HardDrive /> : item === "Cloud" ? <Cloud /> : <Network />}</span>{item}</button>)}</div><div className="routing-facts"><span><ShieldCheck /> No silent fallback</span><span><CircleDollarSign /> Hard budgets enabled</span><span><Lock /> Keys in OS vault</span></div></section>
    <div className="provider-heading"><div><span className="section-kicker">Configured capabilities</span><h2>Provider connections</h2></div><span className="environment-note"><ShieldCheck size={15} /> {environment === "native" ? "OS credential vault" : "Browser demo · values discarded"}</span></div>
    <div className="provider-grid">{providers.map(({ id, name, icon: Icon, detail, tone, local }) => {
      const availability = local ? "manager" : secretRefs[id]?.availability ?? "missing";
      const connected = availability === "present";
      return <article className="provider-card" key={name}><span className={`provider-icon ${tone}`}><Icon size={22} /></span><div><h3>{name}</h3><p>{detail}</p></div><span className={`provider-state ${connected || local ? "" : "add"}`}>{connected || local ? <Check size={13} /> : null}{local ? "Manager ready" : connected ? "Connected" : availability === "keyringUnavailable" ? "Vault unavailable" : "Add key"}</span>{local && <div className="model-meter"><span><b>On-demand profiles</b><small>Nothing bundled · download and verify before use</small></span><div><i style={{ width: "18%" }} /></div></div>}{!local && <button className="icon-button" aria-label={`${connected ? "Manage" : "Add"} ${name} credential`} onClick={() => { setEditingProvider(id); setSecret(""); }}><KeyRound size={17} /></button>}</article>;
    })}</div>
    {editingProvider && <section className="credential-panel" aria-labelledby="credential-title"><div><span className="section-kicker">Credential broker</span><h3 id="credential-title">Connect {providers.find((provider) => provider.id === editingProvider)?.name}</h3><p>{environment === "native" ? "The value goes directly to the operating-system vault. Project files receive only an opaque reference." : "Browser demo mode exercises the flow but immediately discards the value."}</p></div><label>API key<input autoFocus type="password" autoComplete="off" value={secret} onChange={(event) => setSecret(event.target.value)} /></label><div className="credential-actions">{secretRefs[editingProvider]?.availability === "present" && <button className="secondary-button danger-text" onClick={() => { void deleteSecret(editingProvider); setEditingProvider(null); }}><X size={15} /> Remove</button>}<button className="secondary-button" onClick={() => { setEditingProvider(null); setSecret(""); }}>Cancel</button><button className="primary-button" disabled={!secret.trim() || saving} onClick={() => { void saveSecret(); }}><KeyRound size={15} /> {saving ? "Saving…" : "Store securely"}</button></div></section>}
  </div>;
}

function DiagnosticsView({ runtime, onNotify, onReset }: { runtime: RuntimeState; onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void; onReset: () => void }) {
  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const runChecks = async () => {
    setChecking(true);
    try {
      const result = await diagnosticsRun();
      setReport(result);
      onNotify("Diagnostics complete", `${result.checks.filter((check) => check.level === "pass").length} of ${result.checks.length} checks passed; informational and warning results remain visible.`, result.overall === "failure" || result.overall === "warning" ? "warning" : "success");
    } catch (error) {
      onNotify("Diagnostics failed", errorMessage(error), "warning");
    } finally {
      setChecking(false);
    }
  };
  const rows = report?.checks ?? [
    { id: "project-storage", label: "Project storage", level: runtime.bootstrap ? "pass" : "info", summary: runtime.bootstrap?.paths.projects ?? "Waiting for desktop bootstrap" },
    { id: "pipeline-worker", label: "Pipeline worker", level: runtime.bootstrap?.worker.state === "ready" ? "pass" : "warning", summary: workerLabel(runtime.bootstrap?.worker) },
    { id: "frame-renderer", label: "Frame renderer", level: "pass", summary: "Shared deterministic SceneView" },
    { id: "power-profile", label: "Power profile", level: "info", summary: "Silent profile respected; no changes requested" },
  ];
  return <div className="page">
    <PageTitle kicker="Settings & diagnostics" title="A healthy studio is predictable." description="Inspect local runtimes, storage, privacy, accessibility, and recovery without changing your Windows power profile." action={<button className="primary-button" onClick={() => { void runChecks(); }} disabled={checking}>{checking ? <RefreshCw className="spin" size={17} /> : <Activity size={17} />}{checking ? " Running checks" : " Run diagnostics"}</button>} />
    <div className="diagnostics-grid">
      <section className="diagnostic-panel wide"><div className="panel-heading"><div><span className="section-kicker">System readiness</span><h3>{runtime.environment === "native" ? "Native toolchain" : "Browser preview"}</h3></div><span className="health-score">{rows.filter((row) => row.level === "pass").length} / {rows.length} passed</span></div><div className="diagnostic-rows">{rows.map((row) => { const Icon = diagnosticIcon(row.id); const ready = row.level === "pass"; return <div key={row.id}><span className="diagnostic-icon"><Icon size={17} /></span><span><strong>{row.label}</strong><small>{row.summary}</small></span><span className={`check-state ${ready ? "ready" : "attention"}`}>{ready ? <Check size={13} /> : <CircleAlert size={13} />}{row.level}</span></div>; })}</div></section>
      <section className="diagnostic-panel"><span className="section-kicker">Privacy boundary</span><div className="privacy-orbit"><Lock size={22} /><i /><i /></div><h3>Local means local.</h3><p>Analytics are off. Private source contents cannot leave this device unless you explicitly reclassify them.</p><button className="text-button">Review privacy controls <ArrowRight size={15} /></button></section>
      <section className="diagnostic-panel"><span className="section-kicker">Power & performance</span><div className="power-mode"><Moon size={22} /><span><strong>Silent profile respected</strong><small>Benchmarks are estimation-only</small></span></div><p>Alystria won’t change Windows or G-Helper power modes. Use a performance profile only for deliberate benchmark runs.</p><button className="text-button" onClick={() => onNotify("Power profile unchanged", "No benchmark needs boost for functional acceptance.", "info")}>Why this is recommended <ArrowRight size={15} /></button></section>
      <section className="diagnostic-panel wide compact-settings"><div><span className="section-kicker">Recovery & maintenance</span><h3>Local state controls</h3></div><div className="setting-actions"><button className="secondary-button" onClick={() => onNotify("Backup queued", "A copy-first local project backup will be created by the desktop service.", "info")}><Archive size={16} /> Create backup</button><button className="secondary-button danger-text" onClick={onReset}><RotateCcw size={16} /> Restore demo data</button></div></section>
    </div>
  </div>;
}

function ProjectWorkspace(props: {
  workspace: Workspace;
  project: ProjectRecord;
  activeScene: Scene;
  mode: StudioMode;
  version: number;
  onWorkspace: (workspace: Workspace) => void;
  onScene: (scene: Scene) => void;
  onSelectScene: (sceneId: string) => void;
  onSceneUpdate: (sceneId: string, update: Partial<Scene>) => void;
  onRegenerate: (scene: Scene) => void;
  onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void;
  onAddJob: (job: JobRecord) => void;
  onImportSources: (files: File[]) => Promise<SourceImportReceipt[]>;
  onExportArchive: () => Promise<string>;
  onApproveGeneration: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onRenderScene: (scene: Scene) => void;
  onRepairQa: () => void;
  onExportMaster: (settings: Pick<MasterExportRequest, "aspect" | "resolution" | "fps" | "captions" | "transcript" | "bibliography">) => Promise<JobReceipt>;
}) {
  if (props.workspace === "plan") return <PlanWorkspace {...props} />;
  if (props.workspace === "storyboard") return <StoryboardWorkspace {...props} />;
  if (props.workspace === "studio") return <StudioWorkspace {...props} />;
  if (props.workspace === "review") return <ReviewWorkspace {...props} />;
  return <ExportWorkspace {...props} />;
}

type ProjectWorkspaceProps = Parameters<typeof ProjectWorkspace>[0];

function ProjectHeader({ project, step, title, description, action }: { project: ProjectRecord; step: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="project-page-header"><div><span className="section-kicker">{step} · {project.locale} · {project.audience}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function PlanWorkspace({ project, onNotify, onApproveGeneration, onImportSources, onSceneUpdate, onUndo, onRedo }: ProjectWorkspaceProps) {
  const [tab, setTab] = useState("Learning plan");
  const objectives = ["Explain why the school method creates four half-size products", "Derive the identity that recovers both cross terms from one product", "Work through 1234 × 5678 without skipping place-value reconstruction", "Compare T(n) = 4T(n/2) + O(n) with Karatsuba’s recurrence"];
  return <div className="page project-page plan-workspace">
    <ProjectHeader project={project} step="1 · Plan" title="Shape the learning journey" description="Keep the audience, evidence, objectives, and script connected before a single frame is rendered." action={<button className="primary-button" onClick={onApproveGeneration}>Approve learning plan <ArrowRight size={16} /></button>} />
    <div className="plan-progress" aria-label="Plan progress">{["Brief", "Sources", "Research", "Learning plan", "Script"].map((item, index) => <button key={item} className={tab === item ? "active" : index < 3 ? "complete" : ""} onClick={() => setTab(item)}><i>{index < 3 ? <Check size={13} /> : index + 1}</i><span>{item}</span></button>)}</div>
    <div className="plan-grid">
      <section className="plan-main-card">
        <div className="card-title-row"><div><span className="section-kicker">Instructional blueprint</span><h2>{tab === "Learning plan" ? "From intuition to recurrence" : tab}</h2></div><button className="secondary-button small"><WandSparkles size={15} /> Refine</button></div>
        {tab === "Learning plan" ? <>
          <div className="learner-strip"><div><UserRoundCheck size={18} /><span><small>Learner</small><strong>{project.audience}</strong></span></div><div><Clock3 size={18} /><span><small>Target</small><strong>{project.duration} minutes</strong></span></div><div><Languages size={18} /><span><small>Language</small><strong>{project.locale}</strong></span></div></div>
          <div className="objective-section"><div className="section-number">01</div><div><span className="section-kicker">Learning objectives</span><div className="objective-list">{objectives.map((objective, index) => <div key={objective}><span>{index + 1}</span><p>{objective}</p><button aria-label="Edit objective"><TextCursorInput size={15} /></button></div>)}</div></div></div>
          <div className="objective-section"><div className="section-number">02</div><div><span className="section-kicker">Prerequisite thread</span><div className="prerequisite-thread"><span>Place value</span><ArrowRight /><span>Algebraic expansion</span><ArrowRight /><span>Recursion</span><ArrowRight /><span className="active">Divide & conquer</span></div></div></div>
          <div className="objective-section"><div className="section-number">03</div><div><span className="section-kicker">Misconceptions to surface</span><div className="misconception-grid"><article><CircleAlert /><strong>“Three products means an approximation.”</strong><p>Show the exact identity before discussing speed.</p></article><article><CircleAlert /><strong>“Fewer calls always means faster.”</strong><p>Name base-case and overhead tradeoffs honestly.</p></article></div></div></div>
        </> : tab === "Sources" || tab === "Research" ? <SourceEvidence project={project} research={tab === "Research"} onImportSources={onImportSources} onNotify={onNotify} /> : <ScriptEditor project={project} onNotify={onNotify} onSceneUpdate={onSceneUpdate} onUndo={onUndo} onRedo={onRedo} />}
      </section>
      <aside className="plan-aside">
        <div className="grounding-card"><div className="grounding-head"><span><ShieldCheck size={17} /> Grounded mode</span><span className="toggle-on"><i /></span></div><p>Externally verifiable claims must be connected to evidence before export.</p><div className="grounding-meter"><span><strong>18 / 18</strong><small>claims supported</small></span><ProgressBar value={100} /></div></div>
        <div className="concept-map-card"><span className="section-kicker">Concept map</span><h3>The dependency thread</h3><ConceptDiagram /><div className="legend"><span><i className="indigo-bg" /> objective</span><span><i className="teal-bg" /> evidence</span><span><i className="amber-bg" /> review</span></div></div>
        <div className="approval-note"><Quote size={18} /><p>“The learner should feel the missing multiplication before they see the algebra.”</p><small>Director’s note · version 12</small></div>
      </aside>
    </div>
  </div>;
}

function SourceEvidence({ project, research, onImportSources, onNotify }: { project: ProjectRecord; research: boolean; onImportSources: (files: File[]) => Promise<SourceImportReceipt[]>; onNotify: ProjectWorkspaceProps["onNotify"] }) {
  return <div className="source-evidence"><div className="source-table-head"><span>{research ? "Evidence ledger" : "Project sources"}</span><SourceImportControl label="Add source" onImport={onImportSources} onNotify={onNotify} secondary small /></div>{project.sources.length ? project.sources.map((source) => <article key={source.id}><span className={`source-icon ${source.kind}`}><FileText size={17} /></span><div><strong>{source.title}</strong><small>{source.origin} · {source.license}{source.byteSize ? ` · ${formatBytes(source.byteSize)}` : ""}</small></div><span className="evidence-count">{source.evidence} {research ? "spans" : "claims"}</span><span className={`source-state ${source.status}`}>{source.status === "verified" ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />} {source.status}</span><button className="icon-button"><ChevronRight size={16} /></button></article>) : <EmptyState icon={FileText} title="No source files yet" detail="Choose local files to validate in quarantine and preserve in this project’s content-addressed store." />}</div>;
}

function ScriptEditor({ project, onNotify, onSceneUpdate, onUndo, onRedo }: { project: ProjectRecord; onNotify: ProjectWorkspaceProps["onNotify"]; onSceneUpdate: ProjectWorkspaceProps["onSceneUpdate"]; onUndo?: () => void; onRedo?: () => void }) {
  return <div className="script-editor"><div className="script-toolbar"><span>{project.scenes.reduce((count, scene) => count + scene.narration.split(/\s+/u).filter(Boolean).length, 0)} words · debounced to project history</span><div><button onClick={onUndo} aria-label="Undo durable revision"><Undo2 size={15} /></button><button onClick={onRedo} aria-label="Redo durable revision"><Redo2 size={15} /></button><button onClick={() => onNotify("Script save scheduled", "Scene edits are appended to project.sqlite after a short debounce.")}><Check size={15} /> Save snapshot</button></div></div>{project.scenes.slice(0, 4).map((scene) => <div className="script-block" key={scene.id}><span>S{scene.index.toString().padStart(2, "0")}</span><div><strong>{scene.title}</strong><p contentEditable suppressContentEditableWarning onBlur={(event) => onSceneUpdate(scene.id, { narration: event.currentTarget.textContent ?? "" })}>{scene.narration}</p><small>{scene.citations} citations · {scene.duration}s target</small></div></div>)}</div>;
}

function StoryboardWorkspace({ project, onScene, onRegenerate, onWorkspace }: ProjectWorkspaceProps) {
  const [view, setView] = useState<"cards" | "list">("cards");
  const approved = project.scenes.filter((scene) => scene.status === "approved").length;
  return <div className="page project-page storyboard-workspace">
    <ProjectHeader project={project} step="2 · Storyboard" title="See the teaching sequence" description="Every card joins a learning objective, narration beat, evidence, and visual treatment." action={<div className="header-action-group"><button className="secondary-button" onClick={() => onWorkspace("plan")}><ArrowLeft size={16} /> Learning plan</button><button className="primary-button" onClick={() => onWorkspace("studio")}>Open studio <ArrowRight size={16} /></button></div>} />
    <div className="storyboard-status"><div><span className="status-ring"><strong>{approved}</strong><small>of {project.scenes.length}</small></span><span><strong>{approved} scenes approved</strong><small>Scene 4 needs evidence review before production.</small></span></div><div className="storyboard-toolbar"><button><Sparkles size={15} /> Suggest a scene</button><button><RefreshCw size={15} /> Regenerate all draft scenes</button><span className="view-toggle"><button className={view === "cards" ? "active" : ""} onClick={() => setView("cards")} aria-label="Card view"><TableProperties size={16} /></button><button className={view === "list" ? "active" : ""} onClick={() => setView("list")} aria-label="List view"><AlignLeft size={16} /></button></span></div></div>
    <div className={`storyboard-list ${view}`}>
      <div className="section-thread-label"><span>Section 01</span><strong>The surprising shortcut</strong><small>4:02</small></div>
      {project.scenes.map((scene, index) => <article className={`storyboard-card status-${scene.status}`} key={scene.id}>
        <div className="scene-order"><span>{String(scene.index).padStart(2, "0")}</span><i /></div>
        <button className="scene-thumbnail" onClick={() => onScene(scene)} aria-label={`Edit ${scene.title}`}><SceneArtwork scene={scene} compact /><span className="scene-duration">{formatTime(scene.duration)}</span><span className="scene-play"><Play size={15} fill="currentColor" /></span></button>
        <div className="scene-card-copy"><div className="scene-card-top"><span className={`scene-kind kind-${scene.kind}`}>{scene.kind.replace("-", " ")}</span><SceneStatus status={scene.status} /></div><button className="scene-title-button" onClick={() => onScene(scene)}><h3>{scene.title}</h3></button><p>{scene.narration}</p><div className="scene-objective"><span>Teaches</span>{scene.objective}</div><div className="scene-metadata"><span><Link2 size={14} /> {scene.citations} citations</span><span><AudioLines size={14} /> Narration draft</span>{scene.locked && <span><Lock size={13} /> Preserved</span>}</div></div>
        <div className="scene-card-actions"><button className="icon-button"><MoreHorizontal size={17} /></button><button className="secondary-button small" onClick={() => onRegenerate(scene)}><RefreshCw size={14} /> Regenerate</button></div>
        {index === 3 && <div className="review-ribbon"><CircleAlert size={14} /> One source span is link-only</div>}
      </article>)}
      <button className="add-scene-card"><Plus size={19} /><span><strong>Add a teaching moment</strong><small>Choose from 28 purpose-built scene families</small></span></button>
    </div>
  </div>;
}

function StudioWorkspace({ project, activeScene, mode, version, onSelectScene, onSceneUpdate, onRegenerate, onUndo, onRedo, onRenderScene }: ProjectWorkspaceProps) {
  const [playing, setPlaying] = useState(false);
  const [inspectorTab, setInspectorTab] = useState("Content");
  const [zoom, setZoom] = useState(72);
  return <div className="studio-workspace">
    <div className="studio-toolbar"><div><span className="scene-crumb">Scene {String(activeScene.index).padStart(2, "0")}</span><strong>{activeScene.title}</strong><SceneStatus status={activeScene.status} /></div><div className="studio-toolbar-center"><button onClick={onUndo} aria-label="Undo durable revision"><Undo2 size={16} /></button><button onClick={onRedo} aria-label="Redo durable revision"><Redo2 size={16} /></button><span className="separator" /><button><Square size={14} /> Fit</button><label><input aria-label="Canvas zoom" type="range" min="45" max="110" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />{zoom}%</label></div><div><button className="secondary-button small" onClick={() => onRegenerate(activeScene)}><WandSparkles size={15} /> New candidate</button><button className="primary-button small" onClick={() => onRenderScene(activeScene)}><Play size={14} /> Render scene</button></div></div>
    <div className="studio-layout">
      <aside className="scene-rail"><div className="scene-rail-head"><span>Scenes</span><button><Plus size={15} /></button></div><div className="scene-rail-list">{project.scenes.map((scene) => <button className={scene.id === activeScene.id ? "active" : ""} onClick={() => onSelectScene(scene.id)} key={scene.id}><span className="rail-index">{String(scene.index).padStart(2, "0")}</span><span className="rail-thumb"><SceneArtwork scene={scene} compact /></span><span className="rail-copy"><strong>{scene.title}</strong><small>{formatTime(scene.duration)} · {scene.kind.replace("-", " ")}</small></span><i className={`rail-state ${scene.status}`} /></button>)}</div></aside>
      <section className="canvas-stage"><div className="canvas-surround"><div className="canvas-rulers top" /><div className="canvas-rulers side" /><div className="preview-canvas" style={{ width: `${Math.min(92, zoom + 20)}%` }}><SharedScenePreview scene={activeScene} project={project} fallback={<SceneArtwork scene={activeScene} />} /><div className="safe-area" aria-hidden="true" /><div className="frame-badge">SHARED RENDERER · FRAME 01842</div></div></div><div className="playback-bar"><button aria-label="Previous scene"><ArrowLeft size={17} /></button><button className="play-toggle" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause preview" : "Play preview"}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button aria-label="Next scene"><ArrowRight size={17} /></button><span className="timecode">{playing ? "00:00:18:08" : "00:00:00:00"} <i>/</i> 00:01:34:00</span><div className="playback-progress"><i style={{ width: playing ? "24%" : "0%" }} /></div><button><Volume2 size={16} /></button><button>1×</button></div>
      </section>
      <aside className="inspector"><div className="inspector-tabs">{["Content", "Design", "Motion"].map((tab) => <button className={inspectorTab === tab ? "active" : ""} onClick={() => setInspectorTab(tab)} key={tab}>{tab}</button>)}</div>
        {inspectorTab === "Content" ? <div className="inspector-body"><InspectorSection title="Scene identity"><label>Title<input value={activeScene.title} onChange={(event) => onSceneUpdate(activeScene.id, { title: event.target.value })} /></label><label>Scene family<select value={activeScene.kind} onChange={(event) => onSceneUpdate(activeScene.id, { kind: event.target.value as Scene["kind"] })}><option value="title">Title</option><option value="definition">Definition</option><option value="diagram">Diagram</option><option value="worked-example">Worked example</option><option value="comparison">Comparison</option><option value="code">Code trace</option><option value="recap">Recap</option></select></label></InspectorSection><InspectorSection title="Narration"><textarea rows={7} value={activeScene.narration} onChange={(event) => onSceneUpdate(activeScene.id, { narration: event.target.value })} /><div className="field-meta"><span>{activeScene.narration.split(" ").length} words</span><span>~{activeScene.duration}s</span></div><button className="secondary-button full"><Mic2 size={15} /> Voice & pronunciation</button></InspectorSection><InspectorSection title="Evidence"><button className="evidence-chip"><ShieldCheck size={15} /><span><strong>{activeScene.citations} supported claims</strong><small>View evidence spans</small></span><ChevronRight size={15} /></button></InspectorSection>{mode === "studio" && <InspectorSection title="Dependency impact"><p className="inspector-note">Editing narration invalidates alignment, captions, presenter timing, scene render, and final composition.</p></InspectorSection>}</div>
        : inspectorTab === "Design" ? <DesignInspector /> : <MotionInspector studioMode={mode === "studio"} />}
      </aside>
    </div>
    <div className="timeline-panel"><div className="timeline-tools"><button><PanelRightClose size={15} /> Timeline</button><span>00:00</span><span>00:20</span><span>00:40</span><span>01:00</span><span>01:20</span></div><div className="timeline-tracks"><div className="track-labels"><span><Eye size={14} /> Visual</span><span><AudioLines size={14} /> Narration</span><span><AlignLeft size={14} /> Captions</span></div><div className="track-content"><div className="timeline-cursor" style={{ left: playing ? "25%" : "2%" }} /><div className="visual-clip">Formula reveal <small>00:00–01:34</small></div><div className="audio-wave">{Array.from({ length: 90 }, (_, i) => <i key={i} style={{ height: `${8 + ((i * 13) % 24)}px` }} />)}</div><div className="caption-clips"><span style={{ width: "28%" }}>Multiply a plus b…</span><span style={{ width: "34%" }}>Subtract ac and bd…</span><span style={{ width: "29%" }}>Four products become three.</span></div></div></div><div className="version-stamp"><History size={14} /> v{version} saved</div></div>
  </div>;
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="inspector-section"><div className="inspector-section-title"><strong>{title}</strong><ChevronDown size={14} /></div>{children}</section>; }

function DesignInspector() { return <div className="inspector-body"><InspectorSection title="Visual treatment"><div className="style-options"><button className="active"><span className="style-swatch thread-swatch" />Concept thread</button><button><span className="style-swatch formula-swatch" />Formula focus</button><button><span className="style-swatch split-swatch" />Split view</button></div></InspectorSection><InspectorSection title="Responsive layout"><div className="aspect-buttons"><button className="active">16:9</button><button>9:16</button><button>1:1</button></div><p className="inspector-note">Layouts reflow independently for each target. Nothing is cropped.</p></InspectorSection><InspectorSection title="Theme"><button className="theme-choice"><i /><span><strong>Precision paper</strong><small>Project visual bible</small></span><ChevronRight size={15} /></button></InspectorSection></div>; }

function MotionInspector({ studioMode }: { studioMode: boolean }) { return <div className="inspector-body"><InspectorSection title="Choreography"><div className="motion-row"><span><small>Entrance</small><strong>Thread draw</strong></span><span>0.8s</span></div><div className="motion-row"><span><small>Emphasis</small><strong>Term isolate</strong></span><span>2 beats</span></div><div className="motion-row"><span><small>Exit</small><strong>Carry forward</strong></span><span>0.5s</span></div></InspectorSection>{studioMode ? <InspectorSection title="Frame controls"><label>Start tick<input value="240000" readOnly /></label><label>Duration ticks<input value="22560000" readOnly /></label><label>Seed<input value="alya-scene-004" readOnly /></label></InspectorSection> : <div className="guided-callout"><Sparkles size={18} /><strong>Timing is guided by narration.</strong><p>Switch to Studio mode for exact ticks, easing curves, and responsive overrides.</p></div>}</div>; }

function ReviewWorkspace({ project, onWorkspace, onScene, onRepairQa }: ProjectWorkspaceProps) {
  const [playing, setPlaying] = useState(false);
  const checks = [
    { title: "Claim support", result: "18 / 18 supported", tone: "pass", icon: ShieldCheck },
    { title: "Caption safety", result: "8 / 8 scenes pass", tone: "pass", icon: AlignLeft },
    { title: "Narration timing", result: "1 scene needs review", tone: "warn", icon: AudioLines },
    { title: "Visual contrast", result: "AA across all targets", tone: "pass", icon: Eye },
    { title: "Asset rights", result: "1 link-only source", tone: "warn", icon: FileCheck2 },
    { title: "Frame continuity", result: "No blank frames", tone: "pass", icon: Film },
  ];
  return <div className="page project-page review-workspace"><ProjectHeader project={project} step="4 · Review" title="Review the whole argument" description="Watch continuously, inspect the evidence behind each moment, and resolve the checks that can block export." action={<div className="header-action-group"><button className="secondary-button" onClick={() => onWorkspace("studio")}>Back to studio</button><button className="primary-button" onClick={() => onWorkspace("export")}>Prepare export <ArrowRight size={16} /></button></div>} />
    <div className="review-layout"><section className="review-player"><div className="review-canvas"><SceneArtwork scene={project.scenes[3]!} /><button className="large-play" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</button><div className="review-caption">Four products become <em>three</em>.</div></div><div className="review-controls"><button onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={17} /> : <Play size={17} />}</button><span>03:14</span><div><i style={{ width: "34%" }} /><b style={{ left: "34%" }} /></div><span>12:00</span><button><Volume2 size={16} /></button><button>CC</button></div><div className="review-scene-strip">{project.scenes.map((scene) => <button key={scene.id} className={scene.index === 4 ? "active" : ""} onClick={() => onScene(scene)}><span>{scene.index}</span><SceneArtwork scene={scene} compact /></button>)}</div></section>
      <aside className="review-inspector"><div className="review-score"><div className="score-ring"><strong>91</strong><span>quality</span></div><div><span className="section-kicker">Review summary</span><h3>Nearly ready to export</h3><p>Resolve two review items. All blocking factual checks pass.</p></div></div><div className="check-list">{checks.map(({ title, result, tone, icon: Icon }) => <button key={title}><span className={`check-icon ${tone}`}><Icon size={17} /></span><span><strong>{title}</strong><small>{result}</small></span><ChevronRight size={16} /></button>)}</div><button className="secondary-button full" onClick={onRepairQa}><WandSparkles size={16} /> Repair selected review item</button></aside>
    </div>
    <section className="claims-panel"><div className="panel-heading"><div><span className="section-kicker">Evidence at this moment</span><h3>Three-product identity</h3></div><span className="source-state verified"><CheckCircle2 size={14} /> Supported</span></div><div className="claim-grid"><article><span>Claim 12</span><p>Subtracting <code>ac</code> and <code>bd</code> from <code>(a+b)(c+d)</code> yields <code>ad+bc</code>.</p><small><Link2 size={13} /> 3 exact source spans</small></article><blockquote>“The middle coefficient can be computed using one additional multiplication…”<cite>Karatsuba & Ofman · 1962 · translated abstract</cite></blockquote><div className="annotation-box"><MessageSquareText size={16} /><textarea aria-label="Review annotation" placeholder="Leave a local review note…" /><button>Save note</button></div></div></section>
  </div>;
}

function ExportWorkspace({ project, onWorkspace, onNotify, onExportArchive, onExportMaster }: ProjectWorkspaceProps) {
  const [aspect, setAspect] = useState("16:9");
  const [quality, setQuality] = useState("1440p");
  const [captions, setCaptions] = useState(true);
  const [bibliography, setBibliography] = useState(true);
  const [transcript, setTranscript] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const exportProject = async () => {
    setExporting(true);
    try {
      const receipt = await onExportMaster({ aspect: aspect as "16:9" | "9:16" | "1:1", resolution: quality as "1080p" | "1440p" | "4K", fps: 30, captions, transcript, bibliography });
      onNotify(receipt.state === "FAILED" || receipt.state === "BLOCKED" ? "Export blocked" : "Export queued", receipt.message, receipt.state === "FAILED" || receipt.state === "BLOCKED" ? "warning" : "info");
    } catch (error) {
      onNotify("Export blocked", errorMessage(error), "warning");
    } finally {
      setExporting(false);
    }
  };
  const archiveProject = async () => {
    setArchiving(true);
    try {
      const path = await onExportArchive();
      onNotify("Portable project archived", path, "success");
    } catch (error) {
      onNotify("Project archive failed", errorMessage(error), "warning");
    } finally {
      setArchiving(false);
    }
  };
  return <div className="page project-page export-workspace"><ProjectHeader project={project} step="5 · Export" title="Package the finished lesson" description="One master, responsive targets, captions, transcript, sources, and provenance—assembled locally." action={<button className="secondary-button" onClick={() => onWorkspace("review")}><ArrowLeft size={16} /> Review</button>} />
    <div className="export-layout"><section className="export-preview-panel"><div className="export-preview"><SceneArtwork scene={project.scenes[0]!} /><span className="export-resolution">2560 × 1440</span></div><div className="export-summary"><span><Film size={17} /><b>{project.duration}:00</b><small>estimated duration</small></span><span><HardDrive size={17} /><b>~1.8 GB</b><small>estimated master</small></span><span><TimerReset size={17} /><b>8–14 min</b><small>silent profile estimate</small></span></div><div className="export-ready"><PackageCheck size={21} /><div><strong>Ready to render</strong><p>All blocking export gates pass. Two non-blocking review notes will be included in the manifest.</p></div></div></section>
      <section className="export-settings"><div className="settings-section"><span className="section-kicker">Frame</span><h3>Format and resolution</h3><label>Aspect ratio<div className="format-options">{([['16:9', 'Landscape'], ['9:16', 'Portrait'], ['1:1', 'Square']] as const).map(([ratio, label]) => <button key={ratio} className={aspect === ratio ? "active" : ""} onClick={() => setAspect(ratio)}><i className={`aspect-shape ratio-${ratio.replace(":", "-")}`} /><span><strong>{ratio}</strong><small>{label}</small></span></button>)}</div></label><label>Resolution<select value={quality} onChange={(event) => setQuality(event.target.value)}><option>1080p</option><option>1440p</option><option>4K</option></select></label><div className="setting-row"><label>Frame rate<select><option>30 fps</option><option>60 fps</option><option>24 fps</option></select></label><label>Codec<select><option>H.264 hardware</option><option>HEVC hardware</option><option>AV1</option></select></label></div></div>
        <div className="settings-section"><span className="section-kicker">Accessibility & evidence</span><h3>Export companions</h3><ToggleRow checked={captions} onChange={setCaptions} title="Captions" detail="WebVTT + styled burn-in" /><ToggleRow checked={transcript} onChange={setTranscript} title="Accessible transcript" detail="Scene headings and descriptions" /><ToggleRow checked={bibliography} onChange={setBibliography} title="Sources & bibliography" detail="Human-readable + JSON manifest" /><ToggleRow checked={true} onChange={() => {}} title="Provenance manifest" detail="Required · cannot be disabled" locked /></div>
        <div className="export-cost"><ShieldCheck size={18} /><div><strong>Local export · no provider cost</strong><small>Project content stays on this device.</small></div></div><button className="secondary-button full" onClick={() => { void archiveProject(); }} disabled={archiving}>{archiving ? <RefreshCw className="spin" size={17} /> : <Archive size={17} />}{archiving ? "Archiving project…" : "Export portable .alytutorial"}</button>{project.nativeArchivePath && <small className="archive-path"><CheckCircle2 size={13} /> Last archive: {project.nativeArchivePath}</small>}<button className="export-button" onClick={() => { void exportProject(); }} disabled={exporting}>{exporting ? <RefreshCw className="spin" size={18} /> : <Download size={18} />}{exporting ? "Submitting render…" : `Render ${quality} master`}<span>{aspect}</span></button>
      </section></div>
  </div>;
}

function ToggleRow({ checked, onChange, title, detail, locked }: { checked: boolean; onChange: (checked: boolean) => void; title: string; detail: string; locked?: boolean }) { return <button className="toggle-row" onClick={() => !locked && onChange(!checked)} aria-pressed={checked}><span className={`switch ${checked ? "on" : ""}`}><i /></span><span><strong>{title}</strong><small>{detail}</small></span>{locked && <Lock size={14} />}</button>; }

function SourceImportControl({ label, onImport, onNotify, secondary = false, small = false }: { label: string; onImport: (files: File[]) => Promise<SourceImportReceipt[]>; onNotify: (title: string, detail: string, tone?: ToastMessage["tone"]) => void; secondary?: boolean; small?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "importing">("idle");
  const choose = async (files: File[]) => {
    if (!files.length) return;
    setStatus("importing");
    try {
      const receipts = await onImport(files);
      onNotify("Sources imported", `${receipts.length} file${receipts.length === 1 ? "" : "s"} validated, quarantined, and added to project history.`, "success");
    } catch (error) {
      onNotify("Source import failed", errorMessage(error), "warning");
    } finally {
      setStatus("idle");
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  return <span className="source-import-control"><input ref={inputRef} aria-label={`${label} files`} className="visually-hidden-file" type="file" multiple accept={SOURCE_FILE_ACCEPT} onChange={(event) => { void choose(Array.from(event.target.files ?? [])); }} /><button className={`${secondary ? "secondary-button" : "primary-button"}${small ? " small" : ""}`} onClick={() => inputRef.current?.click()} disabled={status === "importing"}>{status === "importing" ? <RefreshCw className="spin" size={16} /> : <Upload size={16} />}{status === "importing" ? " Importing…" : ` ${label}`}</button></span>;
}

function SceneArtwork({ scene, compact = false }: { scene: Scene; compact?: boolean }) {
  return <div className={`scene-art scene-art-${scene.visual} ${compact ? "compact" : ""}`} aria-hidden="true">
    <div className="art-grid" /><div className="art-code">ALY / {String(scene.index).padStart(2, "0")}</div>
    {scene.visual === "thread" && <><div className="art-kicker">THE FASTER WAY TO MULTIPLY</div><div className="art-headline">One product<br /><em>disappears.</em></div><div className="art-thread"><i /><i /><i /><i /></div><div className="art-footnote">Karatsuba · divide and conquer</div></>}
    {scene.visual === "split" && <><div className="art-kicker">SPLIT THE PROBLEM</div><div className="number-split"><span>12<small>a</small></span><i>·100 +</i><span>34<small>b</small></span><b>×</b><span>56<small>c</small></span><i>·100 +</i><span>78<small>d</small></span></div><div className="split-brace left" /><div className="split-brace right" /><div className="art-caption">high half <b>→</b> low half</div></>}
    {scene.visual === "formula" && <><div className="art-kicker">THE THREE-PRODUCT INSIGHT</div><div className="formula-stack"><span><small>z₂</small> ac</span><span className="formula-middle"><small>z₁</small> (a+b)(c+d) − ac − bd</span><span><small>z₀</small> bd</span></div><div className="formula-result"><i />3 multiplications, exactly</div></>}
    {scene.visual === "code" && <><div className="art-kicker">TRACE THE RECURSION</div><div className="code-window"><div><i /><i /><i /></div><pre><span>function</span> karatsuba(x, y) {'{'}{"\n"}  <b>if</b> (small) <em>return</em> x * y;{"\n"}  z2 = karatsuba(a, c);{"\n"}  z0 = karatsuba(b, d);{"\n"}  z1 = karatsuba(a+b, c+d);{"\n"}{'}'}</pre></div><div className="trace-pill">call depth · 03</div></>}
    {scene.visual === "summary" && <><div className="art-kicker">THE THREAD, COMPLETE</div><div className="summary-flow"><span>split</span><i /><span>three products</span><i /><span>recover middle</span><i /><span>combine</span></div><div className="summary-equation">T(n) = 3T(n/2) + O(n)</div></>}
  </div>;
}

function ConceptDiagram() { return <svg className="concept-diagram" viewBox="0 0 320 180" role="img" aria-label="A concept map connecting split, expand, reuse, and compare"><path d="M24 92 C68 24,112 30,146 78 S218 156,296 84" /><path d="M54 130 C110 154,176 36,266 42" className="secondary-path" /><g transform="translate(28,82)"><circle r="15" /><text x="24" y="5">split</text></g><g transform="translate(113,51)"><circle r="11" /><text x="18" y="5">expand</text></g><g transform="translate(190,116)"><circle r="13" /><text x="20" y="5">reuse</text></g><g transform="translate(286,84)"><circle r="16" /><text x="-64" y="-24">compare</text></g></svg>; }

function NewTutorialWizard({ environment, onClose, onCreate }: { environment: RuntimeState["environment"]; onClose: () => void; onCreate: (project: ProjectRecord, settings: TutorialCreationSettings) => Promise<void> }) {
  const [step, setStep] = useState(1);
  const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState("Undergraduate students");
  const [duration, setDuration] = useState("10");
  const [locale, setLocale] = useState<ProjectRecord["locale"]>("English");
  const [grounding, setGrounding] = useState("Grounded");
  const [quality, setQuality] = useState("Standard");
  const [creating, setCreating] = useState(false);
  const [sourceFiles, setSourceFiles] = useState<File[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { dialogRef.current?.focus(); }, []);
  const create = async () => {
    const id = `project-${Date.now()}`;
    setCreating(true);
    setCreateError(null);
    try {
      await onCreate(
        { ...defaultSnapshot.projects[0]!, id, title: topic || "Untitled tutorial", topic: topic || "A new idea", description: `A ${grounding.toLowerCase()} tutorial for ${audience.toLowerCase()}.`, audience, locale, duration: Number(duration), progress: 8, status: "Planning", updatedAt: "just now", scenes: defaultSnapshot.projects[0]!.scenes.slice(0, 4).map((scene, index) => ({ ...scene, id: `${id}-scene-${index + 1}`, status: "draft" })), sources: [] },
        { grounding: grounding.toLowerCase() as GroundingMode, quality: quality.toLowerCase() as QualityPreset, sourceFiles },
      );
    } catch (error) {
      setCreateError(errorMessage(error));
      setCreating(false);
    }
  };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="wizard-modal" role="dialog" aria-modal="true" aria-labelledby="wizard-title" tabIndex={-1} ref={dialogRef}>
    <header><div className="brand-lockup"><LogoMark /><span><strong>New tutorial</strong><small>Build the learning plan first</small></span></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
    <div className="wizard-steps">{["Idea", "Learner", "Grounding", "Review"].map((label, index) => <span key={label} className={step === index + 1 ? "active" : step > index + 1 ? "complete" : ""}><i>{step > index + 1 ? <Check size={12} /> : index + 1}</i>{label}</span>)}</div>
    <div className="wizard-body">
      {step === 1 && <div className="wizard-step"><span className="section-kicker">Start with the hard part</span><h2 id="wizard-title">What should become clear?</h2><p>Describe the idea, skill, or question in plain language. You can add documents and URLs after this step.</p><label className="large-input"><WandSparkles size={21} /><textarea autoFocus rows={4} placeholder="e.g. Explain why Karatsuba multiplication needs only three recursive products…" value={topic} onChange={(event) => setTopic(event.target.value)} /></label><div className="prompt-suggestions"><button onClick={() => setTopic("Explain why Karatsuba multiplication needs only three recursive products")}>Karatsuba multiplication</button><button onClick={() => setTopic("Teach binary search through loop invariants and an execution trace")}>Binary search invariants</button><button onClick={() => setTopic("Derive the central limit theorem visually")}>Visual derivation</button></div><div className="source-drop"><Upload size={20} /><span><strong>Add source material</strong><small>{sourceFiles.length ? `${sourceFiles.length} selected · imported privately before generation` : "PDF, DOCX, EPUB, Markdown, or text · 8 MiB each · optional"}</small></span><input ref={sourceInputRef} className="visually-hidden-file" type="file" multiple accept={SOURCE_FILE_ACCEPT} onChange={(event) => setSourceFiles(Array.from(event.target.files ?? []))} /><button onClick={() => sourceInputRef.current?.click()}>{sourceFiles.length ? "Change files" : "Choose files"}</button></div>{sourceFiles.length > 0 && <div className="selected-source-list" aria-label="Selected source files">{sourceFiles.map((file) => <span key={`${file.name}-${file.lastModified}`}><FileCheck2 size={14} /> {file.name} <small>{formatBytes(file.size)}</small></span>)}</div>}</div>}
      {step === 2 && <div className="wizard-step"><span className="section-kicker">Choose the teaching context</span><h2>Who is on the other side?</h2><p>Alystria changes prerequisite coverage, vocabulary, pacing, examples, and caption density for the learner.</p><div className="form-grid"><label><span>Audience</span><input value={audience} onChange={(event) => setAudience(event.target.value)} /></label><label><span>Target duration</span><select value={duration} onChange={(event) => setDuration(event.target.value)}><option value="5">About 5 minutes</option><option value="10">About 10 minutes</option><option value="15">About 15 minutes</option><option value="25">About 25 minutes</option></select></label><label><span>Language</span><select value={locale} onChange={(event) => setLocale(event.target.value as ProjectRecord["locale"])}><option>English</option><option>Spanish</option><option>Hindi</option></select></label><label><span>Format</span><select><option>Visual explanation</option><option>Code walkthrough</option><option>Presenter with slides</option><option>Worked derivation</option></select></label></div><div className="learner-card"><UserRoundCheck size={22} /><div><strong>{audience}</strong><p>Alystria will assume basic algebra, introduce divide and conquer before asymptotic analysis, and surface common misconceptions.</p></div></div></div>}
      {step === 3 && <div className="wizard-step"><span className="section-kicker">Lock the trust boundary</span><h2>How should Alystria research?</h2><p>No cloud call happens until its provider, data class, retention policy, and cost are approved.</p><div className="choice-cards">{([
        { name: "Creative", detail: "Use the prompt as the source of truth", icon: Sparkles }, { name: "Grounded", detail: "Connect verifiable claims to reliable evidence", icon: ShieldCheck }, { name: "Strict", detail: "Block every unsupported external claim", icon: Lock },
      ] satisfies Array<{ name: string; detail: string; icon: LucideIcon }>).map(({ name, detail, icon: Icon }) => <button key={name} className={grounding === name ? "active" : ""} onClick={() => setGrounding(name)}><span><Icon size={20} /></span><strong>{name}</strong><small>{detail}</small>{grounding === name && <CheckCircle2 size={17} />}</button>)}</div><div className="privacy-selection"><Lock size={18} /><div><strong>Private sources remain local</strong><p>Imported documents start as Local only. Reclassifying them always requires an explicit decision.</p></div><span className="toggle-on"><i /></span></div></div>}
      {step === 4 && <div className="wizard-step review-step"><span className="section-kicker">Ready to shape the lesson</span><h2>Review the learning brief</h2><div className="brief-preview"><div className="brief-topic"><span>Topic</span><h3>{topic || "Untitled tutorial"}</h3></div><dl><div><dt>Audience</dt><dd>{audience}</dd></div><div><dt>Duration</dt><dd>About {duration} minutes</dd></div><div><dt>Language</dt><dd>{locale}</dd></div><div><dt>Research</dt><dd>{grounding}</dd></div><div><dt>Sources</dt><dd>{sourceFiles.length ? `${sourceFiles.length} private file${sourceFiles.length === 1 ? "" : "s"}` : "None yet"}</dd></div><div><dt>Privacy</dt><dd>Local only</dd></div><div><dt>Storage</dt><dd>{environment === "native" ? "Native project folder" : "Browser demo"}</dd></div></dl></div><div className="quality-choice"><div><strong>Creation quality</strong><small>Quality changes model routing and review depth.</small></div>{["Draft", "Standard", "Maximum"].map((item) => <button key={item} className={quality === item ? "active" : ""} onClick={() => setQuality(item)}>{item}</button>)}</div><div className="cost-approval"><CircleDollarSign size={20} /><div><strong>Estimated plan cost: $0.12–$0.34</strong><p>Only the learning plan is generated now. Visual, speech, and render costs are approved later.</p></div></div>{createError && <div className="create-error" role="alert"><CircleAlert size={17} /><span><strong>Project creation failed</strong><small>{createError}</small></span></div>}</div>}
    </div>
    <footer><button className="secondary-button" disabled={creating} onClick={step === 1 ? onClose : () => setStep((value) => value - 1)}>{step === 1 ? "Cancel" : <><ArrowLeft size={15} /> Back</>}</button><span>Step {step} of 4</span>{step < 4 ? <button className="primary-button" disabled={step === 1 && !topic.trim()} onClick={() => setStep((value) => value + 1)}>Continue <ArrowRight size={15} /></button> : <button className="primary-button" disabled={creating} onClick={() => { void create(); }}>{creating ? <RefreshCw className="spin" size={16} /> : <Sparkles size={16} />}{creating ? (sourceFiles.length ? "Importing sources…" : "Creating local project…") : "Create learning plan"}</button>}</footer>
  </div></div>;
}

function RegenerationSheet({ scene, onClose, onRun }: { scene: Scene; onClose: () => void; onRun: (instruction: string, preserve: boolean, alternatives: number) => void }) {
  const [instruction, setInstruction] = useState("");
  const [preserve, setPreserve] = useState(true);
  const [alternatives, setAlternatives] = useState(1);
  return <div className="sheet-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="regen-sheet" role="dialog" aria-modal="true" aria-labelledby="regen-title"><header><div><span className="section-kicker">Scoped regeneration</span><h2 id="regen-title">Create a new candidate</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></header><div className="regen-scene"><span>{String(scene.index).padStart(2, "0")}</span><div><strong>{scene.title}</strong><small>{scene.kind.replace("-", " ")} · {scene.duration}s</small></div></div><label className="instruction-field"><span>What should change?</span><textarea autoFocus rows={5} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Make the transition from four products to three feel inevitable. Keep the exact algebra and citations." /></label><div className="quick-instructions"><button onClick={() => setInstruction("Make the explanation more concrete without adding length.")}>More concrete</button><button onClick={() => setInstruction("Reduce narration by 20% while preserving every factual claim.")}>Tighter</button><button onClick={() => setInstruction("Try a more visual treatment using the concept thread.")}>More visual</button></div><section className="preservation-section"><span className="section-kicker">Preservation locks</span><ToggleRow checked={preserve} onChange={setPreserve} title="Keep narration and citations" detail="Regenerate only the visual treatment" /><ToggleRow checked={true} onChange={() => {}} title="Keep learning objective" detail={scene.objective} locked /><label>Alternatives<select value={alternatives} onChange={(event) => setAlternatives(Number(event.target.value))}><option value={1}>1 candidate</option><option value={2}>2 candidates</option><option value={3}>3 candidates</option><option value={4}>4 candidates</option></select></label></section><section className="impact-preview"><div><Network size={17} /><span><strong>Dependency impact</strong><small>Visual layout, scene render, visual QA, and final composition</small></span></div><div><CircleDollarSign size={17} /><span><strong>Estimated cost</strong><small>$0.03–$0.08 · one image call at most</small></span></div><div><History size={17} /><span><strong>Accepted version is safe</strong><small>This creates a candidate. Nothing is overwritten.</small></span></div></section><footer><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={!instruction.trim()} onClick={() => onRun(instruction, preserve, alternatives)}><WandSparkles size={16} /> Generate candidate</button></footer></aside></div>;
}

function JobsDrawer({ open, jobs, nativeJobIds, onClose, onCancel, onRetry }: { open: boolean; jobs: JobRecord[]; nativeJobIds: ReadonlySet<string>; onClose: () => void; onCancel: (id: string) => void; onRetry: (id: string) => void }) {
  return <aside className={`jobs-drawer ${open ? "open" : ""}`} aria-hidden={!open} aria-label="Background jobs"><header><div><span className="section-kicker">Durable work queue</span><h2>Jobs</h2></div><button className="icon-button" onClick={onClose}><PanelRightClose size={18} /></button></header><div className="jobs-summary"><div><Activity size={17} /><span><strong>{jobs.filter((job) => job.status === "running").length} active</strong><small>Editing remains available</small></span></div><div className="local-job-badge"><HardDrive size={14} /> Local worker</div></div><div className="jobs-list">{jobs.length ? jobs.map((job) => <article className={`job-card ${job.status}`} key={job.id}><div className="job-icon">{job.status === "complete" ? <Check size={16} /> : job.status === "attention" ? <CircleAlert size={16} /> : <RefreshCw className={job.status === "running" ? "spin" : ""} size={16} />}</div><div className="job-copy"><div><strong>{job.title}</strong><span>{job.status}</span></div><p>{job.detail}</p>{job.status !== "complete" && <ProgressBar value={job.progress} />}<small>{job.eta}{job.cost && <> · {job.cost}</>}</small></div><div className="job-actions">{job.status === "attention" && nativeJobIds.has(job.id) && <button className="icon-button" onClick={() => onRetry(job.id)} aria-label={`Retry ${job.title}`}><RotateCcw size={14} /></button>}{job.status !== "complete" && <button className="icon-button" onClick={() => onCancel(job.id)} aria-label={`Cancel ${job.title}`}><X size={15} /></button>}</div></article>) : <EmptyState icon={CheckCircle2} title="No queued work" detail="New render and generation jobs appear here." />}</div><footer><ShieldCheck size={15} /> Native jobs recover after an app restart.</footer></aside>;
}

function CommandPalette({ projects, onClose, onNavigate, onOpen }: { projects: ProjectRecord[]; onClose: () => void; onNavigate: (area: GlobalArea) => void; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const filteredProjects = projects.filter((project) => project.title.toLowerCase().includes(query.toLowerCase()));
  return <div className="command-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="command-palette" role="dialog" aria-modal="true"><label><Search size={19} /><input autoFocus placeholder="Search projects or run a command…" value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>esc</kbd></label><div className="command-results"><small>Projects</small>{filteredProjects.map((project) => <button key={project.id} onClick={() => onOpen(project.id)}><span className="command-icon"><Film size={16} /></span><span><strong>{project.title}</strong><small>{project.status} · {project.updatedAt}</small></span><kbd>↵</kbd></button>)}<small>Go to</small>{globalNav.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())).map(({ id, label, icon: Icon }) => <button key={id} onClick={() => onNavigate(id)}><span className="command-icon"><Icon size={16} /></span><span><strong>{label}</strong><small>Alystria area</small></span></button>)}</div></div></div>;
}

function Toast({ toast, onClose }: { toast: ToastMessage; onClose: () => void }) { return <div className={`toast ${toast.tone ?? "success"}`}><span>{toast.tone === "warning" ? <CircleAlert size={17} /> : toast.tone === "info" ? <CircleHelp size={17} /> : <CheckCircle2 size={17} />}</span><div><strong>{toast.title}</strong><p>{toast.detail}</p></div><button onClick={onClose}><X size={14} /></button></div>; }

function RuntimeBadge({ runtime }: { runtime: RuntimeState }) {
  const ready = runtime.bootstrap?.worker.state === "ready";
  return <span className={`runtime-badge ${ready ? "ready" : "attention"}`} title={runtime.error ?? workerLabel(runtime.bootstrap?.worker)}><span className="runtime-dot" />{runtime.environment === "native" ? "Native" : "Browser demo"}<i />{runtime.loading ? "Connecting" : ready ? "Worker ready" : workerLabel(runtime.bootstrap?.worker)}</span>;
}

function PageTitle({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: React.ReactNode }) { return <div className="page-title"><div><span className="section-kicker">{kicker}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>; }
function ProgressBar({ value }: { value: number }) { return <div className="progress-bar" aria-label={`${value}% complete`}><i style={{ width: `${value}%` }} /></div>; }
function StatusPill({ status }: { status: ProjectRecord["status"] }) { return <span className={`status-pill status-${status.toLowerCase().replaceAll(" ", "-")}`}>{status === "Complete" && <Check size={12} />}{status}</span>; }
function SceneStatus({ status }: { status: Scene["status"] }) { return <span className={`scene-status ${status}`}>{status === "approved" ? <CheckCircle2 size={13} /> : status === "attention" ? <CircleAlert size={13} /> : <Clock3 size={13} />}{status === "attention" ? "Needs review" : status}</span>; }
function EmptyState({ icon: Icon, title, detail, action }: { icon: LucideIcon; title: string; detail: string; action?: React.ReactNode }) { return <div className="empty-state"><span><Icon size={25} /></span><h3>{title}</h3><p>{detail}</p>{action}</div>; }
function formatTime(seconds: number) { return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

function workerLabel(worker: BootstrapInfo["worker"] | undefined): string {
  if (!worker) return "Not connected";
  if (worker.state === "ready") return "Ready";
  if (worker.state === "unavailable") return "Unavailable";
  if (worker.state === "degraded") return "Degraded";
  if (worker.state === "failed") return "Needs attention";
  return worker.state.charAt(0).toUpperCase() + worker.state.slice(1);
}

function localeCode(locale: ProjectRecord["locale"]): string {
  if (locale === "Spanish") return "es-ES";
  if (locale === "Hindi") return "hi-IN";
  return "en-US";
}

function projectDirectoryName(title: string): string {
  const slug = title.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 52) || "untitled-tutorial";
  return `${slug}-${Date.now().toString(36)}`;
}

function projectSnapshotDocument(project: ProjectRecord, additions: Record<string, unknown> = {}): Record<string, unknown> {
  const portable = { ...project } as Record<string, unknown>;
  delete portable.nativeProjectId;
  delete portable.nativeProjectDirectory;
  delete portable.nativeHeadRevisionId;
  delete portable.nativeRevisionNumber;
  delete portable.nativeArchivePath;
  delete portable.nativeRepairableFindingIds;
  return { ...portable, ...additions };
}

function hydrateDurableProject(project: ProjectRecord, snapshot: Record<string, unknown>, links: Pick<ProjectRecord, "nativeProjectId" | "nativeProjectDirectory" | "nativeHeadRevisionId" | "nativeRevisionNumber">): ProjectRecord {
  if (typeof snapshot.title !== "string" || !Array.isArray(snapshot.scenes) || !Array.isArray(snapshot.sources)) {
    throw new Error("The durable project snapshot has an unsupported shape.");
  }
  return {
    ...project,
    ...(snapshot as unknown as ProjectRecord),
    id: links.nativeProjectId ?? project.id,
    ...links,
  };
}

async function importSelectedFile(project: ProjectRecord, file: File): Promise<SourceImportReceipt> {
  if (!project.nativeProjectId || !project.nativeProjectDirectory || !project.nativeHeadRevisionId) {
    throw new Error("The project must have a loaded durable snapshot before importing sources.");
  }
  if (file.size > MAX_SOURCE_FILE_BYTES) {
    throw new Error(`${file.name} is ${formatBytes(file.size)}; each source must be 8 MiB or smaller.`);
  }
  const contentBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  return sourceImport({
    projectId: project.nativeProjectId,
    projectDirectory: project.nativeProjectDirectory,
    expectedHeadRevisionId: project.nativeHeadRevisionId,
    filename: file.name,
    mimeType: file.type || inferredMimeType(file.name),
    privacy: "project_local",
    rightsStatus: "unknown",
    contentBase64,
  });
}

function appendImportedSource(project: ProjectRecord, receipt: SourceImportReceipt): ProjectRecord {
  return {
    ...project,
    nativeHeadRevisionId: receipt.headRevisionId,
    nativeRevisionNumber: receipt.revisionNumber,
    sources: [...project.sources, {
      id: receipt.id,
      versionId: receipt.versionId,
      title: receipt.title,
      filename: receipt.filename,
      origin: receipt.origin,
      kind: "document",
      mediaType: receipt.mediaType,
      byteSize: receipt.byteSize,
      artifactHash: receipt.artifactHash,
      storedRelativePath: receipt.storedRelativePath,
      privacy: receipt.privacy,
      rightsStatus: receipt.rightsStatus,
      license: receipt.license,
      attribution: receipt.attribution,
      evidence: receipt.evidence,
      status: receipt.status,
    }],
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function inferredMimeType(filename: string): string {
  const suffix = filename.toLowerCase().split(".").at(-1);
  if (suffix === "pdf") return "application/pdf";
  if (suffix === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (suffix === "pptx") return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (suffix === "epub") return "application/epub+zip";
  if (suffix === "md" || suffix === "markdown") return "text/markdown";
  if (suffix === "csv") return "text/csv";
  if (suffix === "json") return "application/json";
  return "text/plain";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function receiptJob(receipt: JobReceipt, title: string, detail: string, project?: Pick<NativeJobLink, "projectId" | "projectDirectory">): JobRecord {
  const status: JobRecord["status"] = receipt.state === "SUCCEEDED"
    ? "complete"
    : receipt.state === "RUNNING"
      ? "running"
      : receipt.state === "QUEUED" || receipt.state === "READY" || receipt.state === "RETRY_WAIT"
        ? "queued"
        : "attention";
  const eta = status === "attention" ? (receipt.retryable ? "retry available" : "review required") : status === "queued" ? "queued" : status === "running" ? "in progress" : null;
  return {
    id: receipt.jobId,
    title,
    detail: receipt.message || detail,
    status,
    progress: status === "complete" ? 100 : status === "running" ? 12 : 0,
    ...(eta ? { eta } : {}),
    ...(project ? { projectId: project.projectId, projectDirectory: project.projectDirectory } : {}),
    retryable: receipt.retryable,
    ...(receipt.operation ? { operation: receipt.operation } : {}),
    ...(receipt.result !== undefined ? { result: receipt.result } : {}),
  };
}

function nativeJobLinks(jobs: readonly JobRecord[]): Record<string, NativeJobLink> {
  return Object.fromEntries(jobs.flatMap((job) => job.projectId && job.projectDirectory
    ? [[job.id, { projectId: job.projectId, projectDirectory: job.projectDirectory, jobId: job.id } satisfies NativeJobLink] as const]
    : []));
}

function nativeJobProject(job: JobRecord): Pick<NativeJobLink, "projectId" | "projectDirectory"> | null {
  return job.projectId && job.projectDirectory ? { projectId: job.projectId, projectDirectory: job.projectDirectory } : null;
}

function nativeProjectLink(project: ProjectRecord): Pick<NativeJobLink, "projectId" | "projectDirectory"> | null {
  return project.nativeProjectId && project.nativeProjectDirectory
    ? { projectId: project.nativeProjectId, projectDirectory: project.nativeProjectDirectory }
    : null;
}

function diagnosticIcon(id: string): LucideIcon {
  if (id.includes("worker") || id.includes("python")) return Cpu;
  if (id.includes("ffmpeg") || id.includes("media")) return Film;
  if (id.includes("gpu")) return Gauge;
  if (id.includes("keyring") || id.includes("credential")) return KeyRound;
  if (id.includes("renderer") || id.includes("chromium")) return MonitorPlay;
  if (id.includes("power")) return Moon;
  return HardDrive;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "An unexpected desktop integration error occurred.";
}

export default App;
