import * as vscode from 'vscode';
import { log } from '../utils/Logger';
import { sendEvent } from '../utils/TelemetryManager';

import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';

/**
 * Chat-UI delegate for permission requests (implemented by
 * ChatWebviewProvider). Lets permissions render as inline cards in the
 * session's chat instead of a window-top QuickPick.
 */
export interface PermissionUi {
  /**
   * Show the request as an inline card in the owning session's chat.
   * Resolves with the chosen optionId, or null when no chat surface is
   * available (caller falls back to QuickPick).
   */
  requestPermissionInChat(params: RequestPermissionRequest): Promise<string | null>;
  /** Per-session permission mode: 'ask' | 'acceptEdits' | 'allowAll'. */
  getPermissionMode(sessionId: string): 'ask' | 'acceptEdits' | 'allowAll';
}

/**
 * Handles ACP permission requests from agents.
 * Preferred path: inline card in the session's chat (via PermissionUi),
 * honoring the session's permission mode. Fallback: VS Code QuickPick.
 */
export class PermissionHandler {
  constructor(private readonly ui: PermissionUi | null = null) {}

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const config = vscode.workspace.getConfiguration('acp');
    const autoApprove = config.get<string>('autoApprovePermissions', 'none');

    const title = params.toolCall?.title || 'Permission Request';
    const sessionId = (params as any).sessionId as string | undefined;
    const toolKind = (params.toolCall as any)?.kind as string | undefined;
    const mode = (sessionId && this.ui)
      ? this.ui.getPermissionMode(sessionId)
      : (autoApprove === 'allowAll' ? 'allowAll' : 'ask');

    log(`requestPermission: ${title} (mode=${mode}, kind=${toolKind ?? '?'})`);

    const allowOption = params.options.find(o =>
      o.kind === 'allow_once' || o.kind === 'allow_always'
    );

    // Auto-approve paths: 'allowAll' approves everything; 'acceptEdits'
    // approves file-edit tool calls only.
    const autoApproved =
      (mode === 'allowAll' && allowOption) ||
      (mode === 'acceptEdits' && toolKind === 'edit' && allowOption);
    if (autoApproved && allowOption) {
      sendEvent('permission/requested', { permissionType: title, autoApproved: 'true' });
      return {
        outcome: {
          outcome: 'selected',
          optionId: allowOption.optionId,
        },
      };
    }

    sendEvent('permission/requested', { permissionType: title, autoApproved: 'false' });

    // Preferred: inline card in the session's chat.
    if (this.ui) {
      const optionId = await this.ui.requestPermissionInChat(params);
      if (optionId) {
        log(`Permission selected (chat): ${optionId}`);
        sendEvent('permission/responded', {
          permissionType: title,
          action: optionId,
          outcome: 'selected',
        });
        return {
          outcome: {
            outcome: 'selected',
            optionId,
          },
        };
      }
      // null → no chat surface (or it closed) — fall through to QuickPick.
    }

    // Fallback: QuickPick from agent-provided options.
    const items: (vscode.QuickPickItem & { optionId: string })[] = params.options.map(option => {
      const icon = option.kind.startsWith('allow') ? '$(check)' : '$(x)';
      return {
        label: `${icon} ${option.name}`,
        description: option.kind,
        optionId: option.optionId,
      };
    });

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: title,
      title: 'ACP Agent Permission Request',
      ignoreFocusOut: true,
    });

    if (!selection) {
      log('Permission cancelled by user');
      sendEvent('permission/responded', { permissionType: title, outcome: 'cancelled' });
      return {
        outcome: { outcome: 'cancelled' },
      };
    }

    log(`Permission selected: ${selection.optionId}`);
    sendEvent('permission/responded', {
      permissionType: title,
      action: selection.optionId,
      outcome: 'selected',
    });
    return {
      outcome: {
        outcome: 'selected',
        optionId: selection.optionId,
      },
    };
  }
}
