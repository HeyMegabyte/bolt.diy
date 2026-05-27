import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FeatureSql } from './feature-sql';

describe('FeatureSql', () => {
  let component: FeatureSql;
  let fixture: ComponentFixture<FeatureSql>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FeatureSql],
    }).compileComponents();

    fixture = TestBed.createComponent(FeatureSql);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
