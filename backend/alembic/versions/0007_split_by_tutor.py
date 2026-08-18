"""split balances by tutor

Revision ID: 0007
Revises: 0006

With a second tutor, "the student paid 200" stops being enough: a payment has to
say whose balance it settles. Each tutor also gets their own bank account, so the
transfer code in the student panel points at the right person.

Existing payments are credited to the tutor of that student's most recent lesson,
falling back to whoever entered the payment. With a single tutor this is exact;
the guesswork only matters for data created before the split existed.
"""
from alembic import op
import sqlalchemy as sa

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('users') as batch:
        batch.add_column(sa.Column('bank_account', sa.String(length=26), nullable=True))

    with op.batch_alter_table('payments') as batch:
        batch.add_column(sa.Column('assigned_tutor_id', sa.Integer(), nullable=True))
        batch.create_index(op.f('ix_payments_assigned_tutor_id'), ['assigned_tutor_id'])
        batch.create_foreign_key(
            'fk_payments_assigned_tutor_id_users', 'users', ['assigned_tutor_id'], ['id']
        )

    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE payments
        SET assigned_tutor_id = COALESCE(
            (SELECT l.assigned_tutor_id
               FROM lessons l
              WHERE l.student_id = payments.student_id
                AND l.assigned_tutor_id IS NOT NULL
              ORDER BY l.date DESC
              LIMIT 1),
            tutor_id
        )
    """))


def downgrade() -> None:
    with op.batch_alter_table('payments') as batch:
        batch.drop_constraint('fk_payments_assigned_tutor_id_users', type_='foreignkey')
        batch.drop_index(op.f('ix_payments_assigned_tutor_id'))
        batch.drop_column('assigned_tutor_id')
    with op.batch_alter_table('users') as batch:
        batch.drop_column('bank_account')
