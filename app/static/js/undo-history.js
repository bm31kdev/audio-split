// Keep a bounded history of serializable mix states without coupling the UI to the audio engine.
export function createUndoHistory({ capture, restore, onChange = () => {}, limit = 80 }) {
  const undoStack = [];
  const redoStack = [];
  const activeInteractions = new Set();
  let current = serialize();
  let interactionRecorded = false;
  let applying = false;

  function serialize() {
    return JSON.stringify(capture());
  }

  function updateButtons() {
    onChange({ canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, busy: applying });
  }

  function push(stack, snapshot) {
    stack.push(snapshot);
    if (stack.length > limit) stack.splice(0, stack.length - limit);
  }

  function recordChange() {
    if (applying) return;
    const next = serialize();
    if (next === current) return;
    if (!interactionRecorded) push(undoStack, current);
    interactionRecorded = activeInteractions.size > 0;
    current = next;
    redoStack.length = 0;
    updateButtons();
  }

  function beginInteraction(id) {
    activeInteractions.add(id);
  }

  function endInteraction(id) {
    activeInteractions.delete(id);
    if (activeInteractions.size === 0) interactionRecorded = false;
  }

  function reset() {
    undoStack.length = 0;
    redoStack.length = 0;
    activeInteractions.clear();
    interactionRecorded = false;
    current = serialize();
    updateButtons();
  }

  async function travel(source, destination) {
    if (applying || !source.length) return false;
    const target = source.pop();
    const before = serialize();
    applying = true;
    activeInteractions.clear();
    interactionRecorded = false;
    updateButtons();
    try {
      await restore(JSON.parse(target));
      current = serialize();
      push(destination, before);
      return true;
    } catch (error) {
      source.push(target);
      current = serialize();
      throw error;
    } finally {
      applying = false;
      updateButtons();
    }
  }

  updateButtons();
  return {
    recordChange,
    beginInteraction,
    endInteraction,
    reset,
    undo: () => travel(undoStack, redoStack),
    redo: () => travel(redoStack, undoStack),
  };
}
