// Linear undo/redo over serialized snapshots. Recording an unchanged snapshot is a no-op, so restoring a state and then
// recording again does not grow the stack. No DOM imports.
export class History {
  private states: string[] = [];
  private at = -1;

  constructor(private limit = 200) {}

  /** Records a snapshot unless it equals the current one. Drops any redo states. Returns true when it was added. */
  record(snapshot: string): boolean {
    if (this.states[this.at] === snapshot) return false;
    this.states.length = this.at + 1;
    this.states.push(snapshot);
    if (this.states.length > this.limit) this.states.shift();
    this.at = this.states.length - 1;
    return true;
  }

  get canUndo() { return this.at > 0; }
  get canRedo() { return this.at < this.states.length - 1; }

  undo(): string | null { return this.canUndo ? this.states[--this.at]! : null; }
  redo(): string | null { return this.canRedo ? this.states[++this.at]! : null; }
  get current(): string | undefined { return this.states[this.at]; }
}
