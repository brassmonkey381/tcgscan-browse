export const browseState = {
    cardQuery: '',
    seriesId: null,
    setId: null,
    selection: {},
    sortSel: null,
    similarTo: null,
    similarCards: [],
};
const commandListeners = new Set();
let pendingCommand = null;
/** Deliver a command to the mounted browser(s), or hold it for the next subscriber. */
export function sendBrowseCommand(cmd) {
    if (commandListeners.size === 0) {
        pendingCommand = cmd;
        return;
    }
    commandListeners.forEach((listener) => listener(cmd));
}
/** Subscribe a browser to incoming commands; flushes any pending command immediately. */
export function subscribeBrowseCommand(listener) {
    commandListeners.add(listener);
    if (pendingCommand) {
        const cmd = pendingCommand;
        pendingCommand = null;
        listener(cmd);
    }
    return () => {
        commandListeners.delete(listener);
    };
}
