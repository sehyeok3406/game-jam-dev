import { dialog, Menu, Tray, nativeImage, type BrowserWindow } from 'electron';
import type { SelfHostService } from './service.ts';

export class SelfHostLifecycle {
  private tray: Tray | null = null;
  private closing = false;
  private bypass = false;
  constructor(
    private service: SelfHostService,
    private iconPath: string,
    private updatePrepared: () => boolean,
  ) {}
  attach(window: BrowserWindow, retained: () => void = () => {}) {
    window.on('close', (event) => {
      if (event.defaultPrevented || this.bypass || this.updatePrepared())
        return;
      event.preventDefault();
      if (this.closing) return;
      this.closing = true;
      void this.choose(window).finally(() => {
        this.closing = false;
        if (!window.isDestroyed()) retained();
      });
    });
  }
  private async choose(window: BrowserWindow) {
    try {
      await this.service.run('check');
      const state = this.service.state;
      const live =
        state.checks?.runtimeValid === false ||
        state.checks?.serverOwnership !== 'absent' ||
        state.checks?.tunnelOwnership !== 'absent';
      if (state.stage === 'problem' && !state.checks) {
        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          message: '서버 상태를 확인하지 못했습니다.',
          detail:
            '서버 관리 화면에서 다시 확인하거나 AI 요청문으로 도움을 받으세요.',
          buttons: ['돌아가기', '창 숨기기 · 서버 유지'],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response === 1) {
          this.ensureTray(window);
          window.hide();
        }
        return;
      }
      if (!live) {
        this.close(window);
        return;
      }
      let choice = state.closeBehavior;
      if (choice === 'ask') {
        const result = await dialog.showMessageBox(window, {
          type: 'question',
          title: '협업 서버 유지',
          message: '창을 닫은 뒤 협업 서버를 어떻게 할까요?',
          detail:
            '계속 실행하면 작업 표시줄의 숨겨진 아이콘에서 상태를 확인하거나 서버를 끌 수 있습니다. PC 절전·종료 시에는 접속이 끊깁니다.',
          buttons: ['서버 계속 실행', '서버 종료', '취소'],
          defaultId: 0,
          cancelId: 2,
          checkboxLabel: '다음에도 이 선택 사용',
          checkboxChecked: false,
        });
        if (result.response === 2) return;
        choice = result.response === 0 ? 'background' : 'stop';
        if (result.checkboxChecked) await this.service.setCloseBehavior(choice);
      }
      if (choice === 'background') {
        this.ensureTray(window);
        window.hide();
        this.tray?.displayBalloon({
          title: 'Game Jam! 협업 서버 실행 중',
          content:
            '이 PC가 협업 서버를 유지합니다. 이 아이콘에서 관리 화면을 열거나 서버를 종료하세요.',
        });
      } else {
        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          message: '참여자의 작업과 AI 실행을 마쳤나요?',
          detail:
            '서버를 종료하면 모든 참가자의 연결이 끊깁니다. 저장된 프로젝트는 보존됩니다.',
          buttons: ['서버 종료', '취소'],
          defaultId: 1,
          cancelId: 1,
        });
        if (result.response === 1) return;
        await this.service.run('stop');
        if (this.service.state.stage === 'problem') {
          await dialog.showMessageBox(window, {
            type: 'warning',
            message: this.service.state.message,
            buttons: ['돌아가기'],
          });
          return;
        }
        this.close(window);
      }
    } catch {
      await dialog.showMessageBox(window, {
        type: 'warning',
        message:
          '서버 종료 처리를 완료하지 못했습니다. 관리 화면에서 다시 확인하세요.',
        buttons: ['돌아가기'],
      });
    }
  }
  private close(window: BrowserWindow) {
    this.bypass = true;
    this.tray?.destroy();
    this.tray = null;
    window.close();
  }
  private ensureTray(window: BrowserWindow) {
    if (this.tray) return;
    this.tray = new Tray(nativeImage.createFromPath(this.iconPath));
    this.tray.setToolTip('Game Jam! · 협업 서버 실행 중');
    const show = () => {
      window.show();
      window.focus();
      window.webContents.send('self-host:open');
    };
    this.tray.on('double-click', show);
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '서버 상태 및 관리', click: show },
        {
          label: '서버 종료 후 앱 닫기',
          click: () => {
            show();
            void this.stopFromTray(window);
          },
        },
        { type: 'separator' },
        { label: 'PC 종료·절전 시 서버 연결도 종료됩니다', enabled: false },
      ]),
    );
  }
  private async stopFromTray(window: BrowserWindow) {
    const result = await dialog.showMessageBox(window, {
      type: 'warning',
      message: '참가자의 저장과 AI 작업 완료를 확인했나요?',
      detail:
        '서버를 종료하면 모든 참가자의 연결이 끊깁니다. 프로젝트 데이터는 보존됩니다.',
      buttons: ['서버 종료 후 앱 닫기', '취소'],
      defaultId: 1,
      cancelId: 1,
    });
    if (result.response === 1) return;
    await this.service.run('stop');
    if (this.service.state.stage === 'problem') {
      await dialog.showMessageBox(window, {
        type: 'warning',
        message: this.service.state.message,
        buttons: ['확인'],
      });
      return;
    }
    this.close(window);
  }
  dispose() {
    this.tray?.destroy();
    this.tray = null;
  }
}
