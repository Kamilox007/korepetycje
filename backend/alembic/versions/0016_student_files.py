"""student materials (PDF files)

Revision ID: 0016
Revises: 0015

Files a tutor hands a student - worksheets, solutions, notes as PDF. Bytes
live on disk in the same content-addressed store as board images
(BOARD_FILES_PATH); only metadata is here. A student sees their own files
in the panel next to their boards.
"""
from alembic import op
import sqlalchemy as sa

revision = '0016'
down_revision = '0015'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'student_files',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('student_id', sa.Integer(), nullable=False),
        sa.Column('uploaded_by_user_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('sha256', sa.String(length=64), nullable=False),
        sa.Column('mime', sa.String(length=60), nullable=False),
        sa.Column('bytes', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['student_id'], ['students.id'], name=op.f('fk_student_files_student_id_students'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['uploaded_by_user_id'], ['users.id'], name=op.f('fk_student_files_uploaded_by_user_id_users')),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_student_files')),
    )
    op.create_index(op.f('ix_student_files_sha256'), 'student_files', ['sha256'], unique=False)
    op.create_index(op.f('ix_student_files_student_id'), 'student_files', ['student_id'], unique=False)


def downgrade() -> None:
    op.drop_table('student_files')
