import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureBilling } from './feature-billing';

describe('FeatureBilling', () => {
  let component: FeatureBilling;
  let fixture: ComponentFixture<FeatureBilling>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureBilling],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureBilling);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
