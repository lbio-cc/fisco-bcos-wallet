/// <reference types="vite/client" />

interface ChromeRuntime {
  lastError?: { message: string }
  readonly id: string
  getURL(path: string): string
  sendMessage(message: unknown, callback: (response: any) => void): void
  onMessage: {
    addListener(
      listener: (
        message: any,
        sender: { id?: string; origin?: string; url?: string },
        sendResponse: (response: unknown) => void,
      ) => boolean,
    ): void
    removeListener(
      listener: (
        message: any,
        sender: { id?: string; origin?: string; url?: string },
        sendResponse: (response: unknown) => void,
      ) => boolean,
    ): void
  }
}

interface ChromeStorageArea {
  get(
    key: string | string[] | null,
    callback: (values: Record<string, unknown>) => void,
  ): void
  set(values: Record<string, unknown>, callback: () => void): void
  remove(keys: string | string[], callback: () => void): void
}

interface ChromeStorageChanges {
  [key: string]: { oldValue?: unknown; newValue?: unknown }
}

interface ChromeAlarms {
  create(
    name: string,
    alarmInfo: { when?: number; periodInMinutes?: number },
    callback?: () => void,
  ): void
  clear(name: string, callback?: (wasCleared: boolean) => void): void
  get(
    name: string,
    callback: (alarm?: { name: string; scheduledTime: number }) => void,
  ): void
  onAlarm: {
    addListener(listener: (alarm: { name: string; scheduledTime: number }) => void): void
  }
}

interface ChromeTabs {
  create(createProperties: { url: string; active?: boolean }): void
  query(
    queryInfo: { active?: boolean; currentWindow?: boolean },
    callback: (tabs: Array<{ id?: number; url?: string }>) => void,
  ): void
  sendMessage(tabId: number, message: unknown, callback: () => void): void
}

interface ChromeWindow {
  id?: number
}

interface ChromeWindows {
  create(
    createData: {
      url: string
      type: 'popup'
      focused: boolean
      width: number
      height: number
    },
    callback: (window?: ChromeWindow) => void,
  ): void
  remove(windowId: number, callback: () => void): void
  onRemoved: {
    addListener(listener: (windowId: number) => void): void
  }
}

declare const chrome: {
  runtime: ChromeRuntime
  storage: {
    local: ChromeStorageArea
    session?: ChromeStorageArea
    onChanged: {
      addListener(
        listener: (changes: ChromeStorageChanges, areaName: string) => void,
      ): void
      removeListener(
        listener: (changes: ChromeStorageChanges, areaName: string) => void,
      ): void
    }
  }
  alarms: ChromeAlarms
  tabs?: ChromeTabs
  windows: ChromeWindows
}

interface Window {
  fisco?: {
    readonly isFiscoWallet: boolean
    request<T = unknown>(request: import('./src/shared/types').ProviderRequest): Promise<T>
    send<T = unknown>(
      method: string,
      params?: import('./src/shared/types').ProviderRequest['params'],
    ): Promise<T>
    send<T = unknown>(
      payload: import('./src/inpage').JsonRpcRequest,
    ): Promise<import('./src/inpage').JsonRpcProviderResponse<T>>
    send<T = unknown>(
      payload: import('./src/inpage').JsonRpcRequest,
      callback: import('./src/inpage').JsonRpcCallback<T>,
    ): void
    sendAsync<T = unknown>(
      payload: import('./src/inpage').JsonRpcRequest,
      callback: import('./src/inpage').JsonRpcCallback<T>,
    ): void
    on(event: string, listener: (...args: unknown[]) => void): this
    removeListener(event: string, listener: (...args: unknown[]) => void): this
  }
}
