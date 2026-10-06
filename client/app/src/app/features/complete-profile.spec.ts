import { createSpyObj, type SpyObj } from '../../testing/spy';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { CompleteProfilePageComponent } from './complete-profile';
import { ApiClientService } from '../core/api-client.service';

describe('CompleteProfilePageComponent', () => {
  let fixture: ComponentFixture<CompleteProfilePageComponent>;
  let api: SpyObj<ApiClientService>;
  let router: Router;

  beforeEach(async () => {
    api = createSpyObj<ApiClientService>('ApiClientService', ['completeProfile'], {
      user: { displayName: 'Ada', userId: 'u1' },
    });
    api.completeProfile.mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [CompleteProfilePageComponent],
      providers: [provideRouter([{ path: 'teams', children: [] }]), { provide: ApiClientService, useValue: api }],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(CompleteProfilePageComponent);
    fixture.detectChanges();
  });

  it('renders the profile form', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Finish your profile');
    expect(text).toContain('Birthday');
  });

  it('skips submit when the form is invalid', async () => {
    await fixture.componentInstance.submit();
    expect(api.completeProfile).not.toHaveBeenCalled();
  });

  it('saves the profile and navigates to teams', async () => {
    fixture.componentInstance.form.setValue({ displayName: 'Ada Player', birthday: '2000-01-01' });
    await fixture.componentInstance.submit();
    expect(api.completeProfile).toHaveBeenCalledWith({
      displayName: 'Ada Player',
      birthday: '2000-01-01',
    });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/teams');
    expect(fixture.componentInstance.busy()).toBe(false);
  });

  it('starts with a blank name when no profile is cached', async () => {
    TestBed.resetTestingModule();
    const bare = createSpyObj<ApiClientService>('ApiClientService', ['completeProfile']);
    await TestBed.configureTestingModule({
      imports: [CompleteProfilePageComponent],
      providers: [provideRouter([]), { provide: ApiClientService, useValue: bare }],
    }).compileComponents();
    const page = TestBed.createComponent(CompleteProfilePageComponent);
    expect(page.componentInstance.form.getRawValue().displayName).toBe('');
  });

  it('shows a generic error when save rejects with a non-error', async () => {
    api.completeProfile.mockRejectedValue('nope');
    fixture.componentInstance.form.setValue({ displayName: 'Ada', birthday: '2000-01-01' });
    await fixture.componentInstance.submit();
    expect(fixture.componentInstance.error()).toBe('request_failed');
  });

  it('shows an error when save fails', async () => {
    api.completeProfile.mockRejectedValue(new Error('request_failed'));
    fixture.componentInstance.form.setValue({ displayName: 'Ada', birthday: '2000-01-01' });
    await fixture.componentInstance.submit();
    expect(fixture.componentInstance.error()).toBe('request_failed');
    expect(fixture.componentInstance.busy()).toBe(false);
  });
});
