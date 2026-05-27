import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureSnapshots } from './feature-snapshots';

describe('FeatureSnapshots', () => {
  let component: FeatureSnapshots;
  let fixture: ComponentFixture<FeatureSnapshots>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureSnapshots],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureSnapshots);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
