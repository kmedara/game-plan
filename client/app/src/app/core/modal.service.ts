/**
 * Reusable modal that injects a component into a dialog shell.
 */

import {
  ApplicationRef,
  Component,
  EnvironmentInjector,
  Injectable,
  Injector,
  Type,
  ViewChild,
  ViewContainerRef,
  createComponent,
  inject,
  input,
  AfterViewInit,
  HostListener,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Handle given to the injected component so it can close the dialog.
 */
export class ModalRef<R = unknown> {
  private closed = false;

  /**
   * @param done - Resolves the open promise and destroys the shell.
   */
  constructor(private readonly done: (result: R | undefined) => void) {}

  /**
   * Closes the dialog and returns a result to the caller.
   *
   * @param result - Value passed back from {@link ModalService.open}.
   */
  close(result?: R): void {
    if (this.closed) return;
    this.closed = true;
    this.done(result);
  }
}

/** Options for {@link ModalService.open}. */
export type ModalOpenOptions = {
  title: string;
  inputs?: Record<string, unknown>;
};

/**
 * Dialog shell. The service injects the requested component into `outlet`.
 */
@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [MatButtonModule, TranslocoPipe],
  templateUrl: './modal.html',
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 30;
        display: grid;
        place-items: center;
        padding: 1rem;
      }

      .modal-backdrop {
        position: absolute;
        inset: 0;
        background: color-mix(in srgb, var(--mat-sys-scrim) 45%, transparent);
      }

      .modal-panel {
        position: relative;
        width: min(100%, 28rem);
        max-height: min(100%, 40rem);
        overflow: auto;
        background: var(--mat-sys-surface);
        border-radius: 0.75rem;
        padding: 1rem;
        box-shadow: 0 20px 40px color-mix(in srgb, var(--mat-sys-scrim) 20%, transparent);
      }
    `,
  ],
})
export class ModalShellComponent implements AfterViewInit {
  private readonly modalRef = inject(ModalRef);
  private readonly injector = inject(Injector);

  readonly title = input('');
  readonly titleId = 'modal-title';

  /** Component the service asked to inject. */
  contentType: Type<unknown> | undefined;

  /** Inputs applied to the injected component. */
  contentInputs: Record<string, unknown> = {};

  @ViewChild('outlet', { read: ViewContainerRef })
  private outlet?: ViewContainerRef;

  ngAfterViewInit(): void {
    const outlet = this.outlet;
    const contentType = this.contentType;
    if (outlet === undefined || contentType === undefined) return;
    const content = outlet.createComponent(contentType, { injector: this.injector });
    for (const [key, value] of Object.entries(this.contentInputs)) {
      content.setInput(key, value);
    }
    content.changeDetectorRef.detectChanges();
  }

  /** Closes the dialog without a result. */
  dismiss(): void {
    this.modalRef.close();
  }

  /**
   * Closes on Escape.
   *
   * @param event - The key event.
   */
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    event.preventDefault();
    this.dismiss();
  }
}

/**
 * Opens a modal and injects a component into it.
 */
@Injectable({ providedIn: 'root' })
export class ModalService {
  private readonly appRef = inject(ApplicationRef);
  private readonly environmentInjector = inject(EnvironmentInjector);
  private readonly injector = inject(Injector);
  private openShell = false;

  /**
   * Injects `component` into a modal shell.
   *
   * @param component - The component to create inside the dialog.
   * @param options - Title and inputs for that component.
   * @returns The value passed to {@link ModalRef.close}, or `undefined` when dismissed.
   */
  open<R>(component: Type<unknown>, options: ModalOpenOptions): Promise<R | undefined> {
    if (this.openShell) return Promise.resolve(undefined);

    return new Promise((resolve) => {
      let shellRef: ReturnType<typeof createComponent<ModalShellComponent>> | undefined;
      const finish = (result: R | undefined): void => {
        this.openShell = false;
        if (shellRef !== undefined) {
          this.appRef.detachView(shellRef.hostView);
          shellRef.destroy();
          shellRef = undefined;
        }
        resolve(result);
      };

      const modalRef = new ModalRef<R>(finish);
      const injector = Injector.create({
        parent: this.injector,
        providers: [{ provide: ModalRef, useValue: modalRef }],
      });
      shellRef = createComponent(ModalShellComponent, {
        environmentInjector: this.environmentInjector,
        elementInjector: injector,
      });
      shellRef.setInput('title', options.title);
      shellRef.instance.contentType = component;
      shellRef.instance.contentInputs = options.inputs ?? {};
      document.body.appendChild(shellRef.location.nativeElement);
      this.appRef.attachView(shellRef.hostView);
      this.openShell = true;
      shellRef.changeDetectorRef.detectChanges();
    });
  }
}
