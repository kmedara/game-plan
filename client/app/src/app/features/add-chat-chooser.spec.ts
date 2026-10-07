import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AddChatChooserComponent } from './add-chat-chooser';
import { ModalRef } from '../core/modal.service';
import { provideTranslocoForTests } from '../../testing/transloco';

describe('AddChatChooserComponent', () => {
  let fixture: ComponentFixture<AddChatChooserComponent>;
  let modal: { close: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    modal = { close: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [AddChatChooserComponent],
      providers: [...provideTranslocoForTests(), { provide: ModalRef, useValue: modal }],
    }).compileComponents();
    fixture = TestBed.createComponent(AddChatChooserComponent);
  });

  it('offers private chat and closes with that choice', () => {
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Private chat');
    expect(text).not.toContain('Team channel');
    const buttons = fixture.nativeElement.querySelectorAll('button');
    (buttons[0] as HTMLButtonElement).click();
    expect(modal.close).toHaveBeenCalledWith('private');
  });

  it('offers a channel option when allowed', () => {
    fixture.componentRef.setInput('canCreateChannel', true);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Team channel');
    const buttons = fixture.nativeElement.querySelectorAll('button');
    (buttons[1] as HTMLButtonElement).click();
    expect(modal.close).toHaveBeenCalledWith('channel');
  });
});
