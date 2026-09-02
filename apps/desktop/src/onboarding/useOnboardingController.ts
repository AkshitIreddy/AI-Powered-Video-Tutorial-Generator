import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  advanceOnboarding,
  goToOnboardingChapter,
  normalizeOnboardingState,
  replayOnboarding,
  retreatOnboarding,
  shouldOpenFirstRunOnboarding,
  skipOnboarding,
  startOnboarding,
  updateOnboardingConfiguration,
} from "./state";
import type {
  OnboardingChapterId,
  OnboardingConfiguration,
  OnboardingSetupState,
  PersistedOnboardingState,
} from "./types";

export interface UseOnboardingControllerOptions {
  persistedState?: PersistedOnboardingState | null | undefined;
  setupState?: OnboardingSetupState | undefined;
  onPersist: (state: PersistedOnboardingState) => void | Promise<void>;
  onExit?: (state: PersistedOnboardingState) => void;
  onComplete?: (state: PersistedOnboardingState) => void;
  initiallyOpen?: boolean;
  now?: () => string;
}

export interface OnboardingController {
  state: PersistedOnboardingState;
  isOpen: boolean;
  persistenceError: Error | null;
  setOpen: (open: boolean) => void;
  start: () => void;
  next: () => void;
  back: () => void;
  goTo: (chapterId: OnboardingChapterId) => void;
  updateConfiguration: (patch: Partial<OnboardingConfiguration>) => void;
  skip: () => void;
  exit: () => void;
  replay: () => void;
}

const emptySetupState: OnboardingSetupState = {};

export function useOnboardingController({
  persistedState,
  setupState = emptySetupState,
  onPersist,
  onExit,
  onComplete,
  initiallyOpen,
  now,
}: UseOnboardingControllerOptions): OnboardingController {
  const initial = useMemo(
    () => normalizeOnboardingState(persistedState, setupState, now),
    // Setup is intentionally captured at mount; later detections are merged below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [state, setState] = useState(initial);
  const [isOpen, setOpen] = useState(initiallyOpen ?? shouldOpenFirstRunOnboarding(persistedState));
  const [persistenceError, setPersistenceError] = useState<Error | null>(null);
  const mounted = useRef(false);
  const previousStatus = useRef(state.status);

  useEffect(() => {
    setState((current) => normalizeOnboardingState(current, setupState, now));
  }, [setupState, now]);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    let current = true;
    Promise.resolve(onPersist(state)).then(
      () => { if (current) setPersistenceError(null); },
      (error: unknown) => { if (current) setPersistenceError(error instanceof Error ? error : new Error(String(error))); },
    );
    return () => { current = false; };
  }, [onPersist, state]);

  useEffect(() => {
    if (previousStatus.current !== "completed" && state.status === "completed") {
      setOpen(false);
      onComplete?.(state);
    }
    previousStatus.current = state.status;
  }, [onComplete, state]);

  const start = useCallback(() => {
    setState((current) => startOnboarding(current, setupState, now));
    setOpen(true);
  }, [now, setupState]);

  const next = useCallback(() => {
    setState((current) => advanceOnboarding(current, setupState, now));
  }, [now, setupState]);

  const back = useCallback(() => {
    setState((current) => retreatOnboarding(current, now));
  }, [now]);

  const goTo = useCallback((chapterId: OnboardingChapterId) => {
    setState((current) => goToOnboardingChapter(current, chapterId, now));
  }, [now]);

  const updateConfiguration = useCallback((patch: Partial<OnboardingConfiguration>) => {
    setState((current) => updateOnboardingConfiguration(current, patch, setupState, now));
  }, [now, setupState]);

  const skip = useCallback(() => {
    setState((current) => skipOnboarding(current, now));
    setOpen(false);
  }, [now]);

  const exit = useCallback(() => {
    setOpen(false);
    onExit?.(state);
  }, [onExit, state]);

  const replay = useCallback(() => {
    setState((current) => replayOnboarding(current, setupState, now));
    setOpen(true);
  }, [now, setupState]);

  return {
    state,
    isOpen,
    persistenceError,
    setOpen,
    start,
    next,
    back,
    goTo,
    updateConfiguration,
    skip,
    exit,
    replay,
  };
}
