// Entry of the sandbox's main bundle. Re-exports only, no logic: everything
// that decides what extensions may do lives in Code's own buildless
// web/js/ext2/sandbox-relay.js, which receives this module namespace.
export {
  initialize, getService, StandaloneServices, SyncDescriptor,
  ICommandService, ICodeEditorService, ILanguageFeaturesService, ILanguageService, IModelService,
  IMarkerService, IOpenerService, IClipboardService, IDialogService, IFileDialogService,
  IQuickInputService, INotificationService, IEditorService, IBulkEditService, IInstantiationService,
} from '@codingame/monaco-vscode-api';
export { registerExtension, ExtensionHostKind } from '@codingame/monaco-vscode-api/extensions';
export { registerAssets } from '@codingame/monaco-vscode-api/assets';
export { default as getExtensionServiceOverride } from '@codingame/monaco-vscode-extensions-service-override';
export { default as getKeybindingsServiceOverride } from '@codingame/monaco-vscode-keybindings-service-override';
export { default as getConfigurationServiceOverride, updateUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override';
export { IExtensionService } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/extensions.service';
export { RPCProtocol } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/rpcProtocol';
export { getStringIdentifierForProxy } from '@codingame/monaco-vscode-api/vscode/vs/workbench/services/extensions/common/proxyIdentifier';
export { CommandsRegistry } from '@codingame/monaco-vscode-api/vscode/vs/platform/commands/common/commands';
export { IContextKeyService } from '@codingame/monaco-vscode-api/vscode/vs/platform/contextkey/common/contextkey.service';
export { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
export * as monaco from 'monaco-editor';
