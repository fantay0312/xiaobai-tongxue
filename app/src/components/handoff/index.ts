/** 跨板块交接：发送到、附加上下文、带着内容去别处。 */
export { SendTo, type SendToProps, type SendRoute } from './SendTo';
export { AttachPicker, type AttachPickerProps, type AttachTab } from './AttachPicker';
export { AttachBar, NO_ATTACHMENTS, attachmentCount, type Attachments } from './AttachBar';
export { RecentWork } from './RecentWork';
export { ArtifactKindIcon, shortTime } from './kinds';
export { EMPTY_SELECTION, artifactSourceId, artifactSources, handoffSource, isArtifactSourceId, resolveAttachments, type AttachSelection } from './materials';
export { readHandoff, stashHandoff, type Handoff } from './stash';
export { targetPath, useOpenTarget, type OpenTarget } from './useOpenTarget';
