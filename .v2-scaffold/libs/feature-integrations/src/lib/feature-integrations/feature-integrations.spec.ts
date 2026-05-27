import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureIntegrations } from './feature-integrations';

describe('FeatureIntegrations', () => {
  let component: FeatureIntegrations;
  let fixture: ComponentFixture<FeatureIntegrations>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureIntegrations],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureIntegrations);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
