import { AfterViewInit, Component, inject, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ModalRef,
  ModalService,
  ModalShellComponent,
} from './modal.service';

@Component({
  standalone: true,
  template: '<p>Modal body</p>',
})
class ModalBodyComponent {}

@Component({
  standalone: true,
  template: '',
})
class SaveResultComponent implements AfterViewInit {
  private readonly modalRef = inject(ModalRef<string>);

  ngAfterViewInit(): void {
    this.modalRef.close('ok');
  }
}

describe('ModalRef', () => {
  it('closes only once', () => {
    const done = vi.fn();
    const ref = new ModalRef<string>(done);
    ref.close('ok');
    ref.close('again');
    expect(done).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith('ok');
  });
});

describe('ModalShellComponent', () => {
  it('dismisses on escape', () => {
    const close = vi.fn();
    TestBed.configureTestingModule({
      imports: [ModalShellComponent],
      providers: [{ provide: ModalRef, useValue: { close } }],
    });
    const fixture = TestBed.createComponent(ModalShellComponent);
    fixture.detectChanges();

    const event = new Event('keydown');
    event.preventDefault = vi.fn();
    fixture.componentInstance.onEscape(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });
});

describe('ModalService', () => {
  let modal: ModalService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    modal = TestBed.inject(ModalService);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('opens a component and resolves when it closes with a result', async () => {
    const pending = modal.open(SaveResultComponent, { title: 'Title', inputs: {} });
    await expect(pending).resolves.toBe('ok');
  });

  it('applies content inputs on the injected component', async () => {
    @Component({
      standalone: true,
      template: '<p>{{ label() }}</p>',
    })
    class InputBodyComponent {
      readonly label = input('');
    }

    const pending = modal.open(InputBodyComponent, {
      title: 'With inputs',
      inputs: { label: 'Hello inputs' },
    });
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Hello inputs');
    });
    document.querySelector<HTMLElement>('.modal-backdrop')?.click();
    await pending;
  });

  it('resolves undefined when a modal is already open', async () => {
    const first = modal.open(ModalBodyComponent, { title: 'First' });
    await vi.waitFor(() => {
      expect(document.body.querySelector('app-modal')).not.toBeNull();
    });
    await expect(modal.open(ModalBodyComponent, { title: 'Second' })).resolves.toBeUndefined();
    document.querySelector<HTMLElement>('.modal-backdrop')?.click();
    await first;
  });
});
