import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureCrew } from './feature-crew';

describe('FeatureCrew', () => {
  let component: FeatureCrew;
  let fixture: ComponentFixture<FeatureCrew>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureCrew],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureCrew);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
