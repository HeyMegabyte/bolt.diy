import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureJobs } from './feature-jobs';

describe('FeatureJobs', () => {
  let component: FeatureJobs;
  let fixture: ComponentFixture<FeatureJobs>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureJobs],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureJobs);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
