import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureSettings } from './feature-settings';

describe('FeatureSettings', () => {
  let component: FeatureSettings;
  let fixture: ComponentFixture<FeatureSettings>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureSettings],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureSettings);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
