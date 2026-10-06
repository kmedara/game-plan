import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CompleteProfilePageComponent } from './complete-profile';
import { ApiClient } from '../core/api-client';

describe('CompleteProfilePageComponent', () => {
  let fixture: ComponentFixture<CompleteProfilePageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CompleteProfilePageComponent],
      providers: [
        provideRouter([]),
        {
          provide: ApiClient,
          useValue: {
            user: { displayName: 'Ada', userId: 'u1' },
            completeProfile: jasmine.createSpy('completeProfile'),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CompleteProfilePageComponent);
    fixture.detectChanges();
  });

  it('renders the profile form', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Finish your profile');
    expect(text).toContain('Birthday');
  });
});
