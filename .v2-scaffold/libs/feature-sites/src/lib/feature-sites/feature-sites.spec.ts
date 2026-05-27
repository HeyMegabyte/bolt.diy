import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureSites } from './feature-sites';

describe('FeatureSites', () => {
  let component: FeatureSites;
  let fixture: ComponentFixture<FeatureSites>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureSites],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureSites);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
